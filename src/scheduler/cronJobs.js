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
const ui = require("../ui/ui");

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
      const text = ui.morningCard({ personName: person.name, tasks });
      botInstance.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: ui.inlineDoneButton() });
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
      const chat = getChat(chatId);
      const member = chat.members?.[userId];
      botInstance.sendMessage(
        chatId,
        ui.confirmedCard({ name: member?.name || "Дежурный", points: config.points.perDuty, mode: "auto" }),
        { parse_mode: "HTML" }
      );
      const tomorrow = dutyService.getTomorrowPerson(chatId);
      if (tomorrow) {
        botInstance.sendMessage(chatId, ui.tomorrowCard({ personName: tomorrow.name }), { parse_mode: "HTML" });
      }
      logger.info("Auto-confirmed duty", { chatId, userId });
    } catch (err) {
      logger.error("Auto-confirm notification error", { chatId, userId }, err);
    }
  }
}

/**
 * В 20:00 напоминание, если дежурный ещё не отметил задачи как выполненные.
 */
function runEveningReminder() {
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
      const duty = getChat(chatId).currentDuty;
      if (!duty || duty.date !== today) continue;
      if (duty.status !== "active") continue;

      const person = dutyService.getTodayPerson(chatId);
      if (!person) continue;

      const text = ui.eveningReminderCard({ personName: person.name });
      botInstance.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: ui.inlineDoneButton() });
      logger.info("Evening reminder sent", { chatId });
    } catch (err) {
      logger.error("Evening reminder error", chatId, err);
    }
  }
}

function start() {
  cron.schedule(config.cronMorning, runMorningNotification, { timezone: config.timezone });
  cron.schedule(config.cronAutoConfirm, runAutoConfirm, { timezone: config.timezone });
  cron.schedule(config.cronEveningReminder, runEveningReminder, { timezone: config.timezone });
  logger.info("Cron jobs started: 09:00 morning, 20:00 reminder, 23:00 auto-confirm");
}

module.exports = {
  setBot,
  start,
  runMorningNotification,
  runAutoConfirm,
  runEveningReminder,
};
