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
const ratingService = require("./src/services/ratingService");
const ui = require("./src/ui/ui");

// Один экземпляр бота. Запускайте только один процесс — иначе возможен конфликт 409 (terminated by other getUpdates).
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    interval: 500,
    params: { timeout: 30 },
  },
});

async function sendTodayWho(chatId) {
  const person = dutyService.getTodayPerson(chatId);
  if (!person) {
    await bot.sendMessage(chatId, ui.whoCard({ personName: null }), {
      parse_mode: "HTML",
      reply_markup: ui.replyMenuKeyboard(),
      disable_web_page_preview: true,
    });
    return;
  }
  await bot.sendMessage(chatId, ui.whoCard({ personName: person.name }), {
    parse_mode: "HTML",
    reply_markup: ui.replyMenuKeyboard(),
  });
}

async function sendTodayTasks(chatId, userId) {
  dutyService.ensureDutyForToday(chatId);
  const today = dutyService.getTodayDateStr();
  const person = dutyService.getTodayPerson(chatId);
  const tasks = taskService.getTasksForDate(chatId, today);
  if (!person) {
    await bot.sendMessage(chatId, "<b>📋 Задачи на сегодня</b>\n\nНет участников. Нажмите «ℹ️ Помощь».", {
      parse_mode: "HTML",
      reply_markup: ui.replyMenuKeyboard(),
    });
    return;
  }
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  const canMarkDone = duty && duty.status === "active" && duty.userId === userId;
  const text = ui.tasksCard({ dateStr: today, personName: person.name, tasks });
  const inline = canMarkDone ? [[{ text: "✅ Задачи выполнены", callback_data: "duty:done" }]] : [];
  await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: inline.length ? { inline_keyboard: inline } : ui.replyMenuKeyboard(),
  });
}

async function sendStats(chatId, userId) {
  const stats = ratingService.getMemberStats(chatId, userId);
  if (!stats) {
    await bot.sendMessage(chatId, ui.statsCard(null), { parse_mode: "HTML", reply_markup: ui.replyMenuKeyboard() });
    return;
  }
  await bot.sendMessage(chatId, ui.statsCard(stats), { parse_mode: "HTML", reply_markup: ui.replyMenuKeyboard() });
}

async function sendRating(chatId) {
  const rating = ratingService.getRating(chatId);
  await bot.sendMessage(chatId, ui.ratingCard(rating), { parse_mode: "HTML", reply_markup: ui.replyMenuKeyboard() });
}

async function sendAdminPanel(chatId, userId) {
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.sendMessage(chatId, ui.adminCard({ isAdmin: false }), { parse_mode: "HTML", reply_markup: ui.replyMenuKeyboard() });
    return;
  }
  const text = ui.adminCard({ isAdmin: true });
  const keyboard = {
    inline_keyboard: [
      [
        { text: "➕ Задача", callback_data: "admin:add_task" },
        { text: "📝 Список", callback_data: "admin:list_tasks" },
      ],
      [{ text: "🔄 Сменить дежурного", callback_data: "admin:next_duty" }],
    ],
  };
  await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
}

// —— Команды ——

bot.onText(/\/start/, async (msg) => {
  try {
    await menuController.handleStart(bot, msg);
  } catch (e) {
    logger.error("/start", e);
    await bot.sendMessage(msg.chat.id, "Произошла ошибка.", { reply_markup: ui.replyMenuKeyboard() });
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
      await bot.sendMessage(chatId, `✅ ${ui.escapeHtml(msg.from.first_name || msg.from.username)} добавлен(а) в семью`, {
        parse_mode: "HTML",
        reply_markup: ui.replyMenuKeyboard(),
      });
    } else {
      await bot.sendMessage(chatId, "Вы уже в семье 😊", { reply_markup: ui.replyMenuKeyboard() });
    }
    if (!getChat(chatId).schedule?.order?.length) return;
    dutyService.ensureDutyForToday(chatId);
  } catch (e) {
    logger.error("/join", e);
    await bot.sendMessage(chatId, "Ошибка при добавлении.", { reply_markup: ui.replyMenuKeyboard() });
  }
});

bot.onText(/\/setadmin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const adminController = require("./src/controllers/adminController");
  const result = await adminController.handleSetAdmin(bot, chatId, userId);
  if (result === true) {
    await bot.sendMessage(chatId, "✅ Вы назначены <b>единственным</b> админом этого чата.", {
      parse_mode: "HTML",
      reply_markup: ui.replyMenuKeyboard(),
    });
  } else if (result === "already") {
    await bot.sendMessage(chatId, "Вы уже админ.", { reply_markup: ui.replyMenuKeyboard() });
  } else {
    await bot.sendMessage(chatId, "Сначала напишите /join, чтобы войти в семью.", { reply_markup: ui.replyMenuKeyboard() });
  }
});

bot.onText(/\/today/, async (msg) => {
  await sendTodayWho(msg.chat.id);
});

bot.onText(/\/tasks/, async (msg) => {
  await sendTodayTasks(msg.chat.id, msg.from.id);
});

bot.onText(/\/stats/, async (msg) => {
  await sendStats(msg.chat.id, msg.from.id);
});

// —— Меню-клавиатура (без команд) ——
bot.on("message", async (msg) => {
  const text = msg.text;
  if (!text || typeof text !== "string") return;
  if (text.startsWith("/")) return; // команды обрабатываются отдельно

  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  try {
    if (text === "📋 Задачи") return await sendTodayTasks(chatId, userId);
    if (text === "👤 Дежурный") return await sendTodayWho(chatId);
    if (text === "📊 Статистика") return await sendStats(chatId, userId);
    if (text === "🏆 Рейтинг") return await sendRating(chatId);
    if (text === "⚙️ Админ") return await sendAdminPanel(chatId, userId);
    if (text === "ℹ️ Помощь") return await menuController.handleHelp(bot, msg);
  } catch (e) {
    logger.error("menu message handler", e);
  }
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
