/**
 * Точка входа: один экземпляр бота, polling с drop_pending_updates для избежания 409.
 * Чистая архитектура: controllers / services / storage.
 */
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const logger = require("./src/lib/logger");
const { getChat } = require("./src/storage/storage");
const dutyService = require("./src/services/dutyService");
const taskService = require("./src/services/taskService");
const memberService = require("./src/services/memberService");
const menuController = require("./src/controllers/menuController");
const callbackRouter = require("./src/controllers/callbackRouter");
const cronJobs = require("./src/scheduler/cronJobs");

// Один экземпляр бота. Запускайте только один процесс — иначе возможен конфликт 409 (terminated by other getUpdates).
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    interval: 500,
    params: { timeout: 30 },
  },
});

// —— Команды ——

bot.onText(/\/start/, async (msg) => {
  try {
    await menuController.handleStart(bot, msg);
  } catch (e) {
    logger.error("/start", e);
    await bot.sendMessage(msg.chat.id, "Произошла ошибка.");
  }
});

bot.onText(/\/help/, async (msg) => {
  try {
    await menuController.handleHelp(bot, msg);
  } catch (e) {
    logger.error("/help", e);
  }
});

bot.onText(/\/join/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const added = memberService.addMember(chatId, msg.from);
    if (added) {
      await bot.sendMessage(chatId, `${msg.from.first_name || msg.from.username} добавлен в семью 👌`);
    } else {
      await bot.sendMessage(chatId, "Ты уже в семье 😊");
    }
    if (!getChat(chatId).schedule?.order?.length) return;
    dutyService.ensureDutyForToday(chatId);
  } catch (e) {
    logger.error("/join", e);
    await bot.sendMessage(chatId, "Ошибка при добавлении.");
  }
});

bot.onText(/\/setadmin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const adminController = require("./src/controllers/adminController");
  const added = await adminController.handleSetAdmin(bot, chatId, userId);
  if (added) {
    await bot.sendMessage(chatId, "Вы назначены админом.");
  } else {
    await bot.sendMessage(chatId, "Сначала напишите /join. Или вы уже админ.");
  }
});

bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id;
  const person = dutyService.getTodayPerson(chatId);
  if (!person) {
    await bot.sendMessage(chatId, "Нет участников. Напишите /join");
    return;
  }
  await bot.sendMessage(chatId, `Сегодня дежурный: ${person.name}`);
});

bot.onText(/\/tasks/, async (msg) => {
  const chatId = msg.chat.id;
  dutyService.ensureDutyForToday(chatId);
  const today = dutyService.getTodayDateStr();
  const person = dutyService.getTodayPerson(chatId);
  const tasks = taskService.getTasksForDate(chatId, today);
  if (!person) {
    await bot.sendMessage(chatId, "Нет участников.");
    return;
  }
  let text = `📋 Сегодня дежурный: ${person.name}\n\nЗадачи:\n\n`;
  tasks.forEach((t) => (text += `• ${t.title}\n`));
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  const canMarkDone = duty && duty.status === "active" && duty.userId === msg.from.id;
  const keyboard = {
    inline_keyboard: canMarkDone
      ? [[{ text: "✅ Задачи выполнены", callback_data: "duty:done" }]]
      : [],
  };
  await bot.sendMessage(chatId, text, { reply_markup: keyboard });
});

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const ratingService = require("./src/services/ratingService");
  const stats = ratingService.getMemberStats(chatId, msg.from.id);
  if (!stats) {
    await bot.sendMessage(chatId, "Вы не в семье. /join");
    return;
  }
  let text = `📊 Статистика: ${stats.name}\n\n`;
  text += `Очки: ${stats.points}\nСтрик: ${stats.streak}\n`;
  text += `Был дежурным: ${stats.dutyCount}\nПодтверждено: ${stats.confirmedCount}\n`;
  text += `Отклонено: ${stats.rejectedCount}\nАвто-подтверждений: ${stats.autoConfirmedCount}\n`;
  text += `Бейджи: ${(stats.badges || []).join(", ") || "нет"}`;
  await bot.sendMessage(chatId, text);
});

// —— Callback query (одна точка входа, idempotent) ——

bot.on("callback_query", async (query) => {
  await callbackRouter.route(bot, query);
});

// —— Ошибки и перезапуск ——

bot.on("polling_error", (err) => {
  logger.error("Polling error", err.message);
  if (err.code === 409) {
    logger.warn("409: другой экземпляр getUpdates. Убедитесь, что запущен только один процесс.");
  }
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", err);
});
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled rejection", err);
});

// —— Cron и HTTP keep-alive ——

cronJobs.setBot(bot);
cronJobs.start();

const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (_, res) => res.send("Family Bot alive"));
app.listen(PORT, () => logger.info("HTTP server", PORT));

logger.info("Family Bot started");
