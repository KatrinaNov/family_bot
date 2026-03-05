/**
 * Cron-задачи: утреннее уведомление 09:00, авто-подтверждение 23:00.
 * Запускаются после инициализации бота (один экземпляр).
 */
const cron = require("node-cron");
const config = require("../../config");
const { getChat } = require("../storage/storage");
const dutyService = require("../services/dutyService");
const taskService = require("../services/taskService");
const logger = require("../lib/logger");

let botInstance = null;

function setBot(bot) {
  botInstance = bot;
}

/**
 * Утреннее уведомление 09:00: определить дежурного, задачи на сегодня, отправить сообщение с кнопкой "Задачи выполнены".
 */
function runMorningNotification() {
  if (!botInstance) return;
  const { load } = require("../storage/storage");
  const data = load();
  const today = dutyService.getTodayDateStr();

  for (const chatId of Object.keys(data.chats || {})) {
    try {
      const chat = getChat(chatId);
      const order = chat.schedule?.order || [];
      if (order.length === 0) continue;

      dutyService.ensureDutyForToday(chatId);
      const person = dutyService.getTodayPerson(chatId);
      if (!person) continue;

      const tasks = taskService.getTasksForDate(chatId, today);
      let text = `Доброе утро 🌞\nСегодня дежурный: ${person.name}\n\nСписок задач:\n\n`;
      tasks.forEach((t) => {
        text += `• ${t.title}\n`;
      });

      const keyboard = {
        inline_keyboard: [[{ text: "✅ Задачи выполнены", callback_data: "duty:done" }]],
      };
      botInstance.sendMessage(chatId, text, { reply_markup: keyboard });
      logger.info("Morning notification sent", { chatId });
    } catch (err) {
      logger.error("Morning notification error", chatId, err);
    }
  }
}

/**
 * В 23:00 авто-подтверждение всех pending_confirmation; уведомления пользователям.
 */
function runAutoConfirm() {
  if (!botInstance) return;
  const results = dutyService.autoConfirmPendingDuties();
  for (const { chatId, userId } of results) {
    try {
      botInstance.sendMessage(chatId, "Задачи автоматически засчитаны ✅ Баллы начислены.");
      logger.info("Auto-confirmed duty", { chatId, userId });
    } catch (err) {
      logger.error("Auto-confirm notification error", { chatId, userId }, err);
    }
  }
}

function start() {
  cron.schedule(config.cronMorning, runMorningNotification, { timezone: config.timezone });
  cron.schedule(config.cronAutoConfirm, runAutoConfirm, { timezone: config.timezone });
  logger.info("Cron jobs started: 09:00 morning, 23:00 auto-confirm");
}

module.exports = {
  setBot,
  start,
  runMorningNotification,
  runAutoConfirm,
};
