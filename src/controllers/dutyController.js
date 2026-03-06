/**
 * Обработка кнопки "Задачи выполнены", подтверждение/отклонение админом.
 * Idempotent: повторное нажатие не создаёт дубликаты.
 */
const { getChat } = require("../storage/storage");
const dutyService = require("../services/dutyService");
const memberService = require("../services/memberService");
const logger = require("../lib/logger");
const ui = require("../ui/ui");
const config = require("../../config");

/** Обработка duty:done — дежурный нажал "Задачи выполнены" */
async function handleDutyDone(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const res = dutyService.submitDutyForConfirmation(chatId, userId);
  await bot.answerCallbackQuery(query.id, { text: res.error || (res.already ? "Уже отправлено на подтверждение" : "Отправлено админу") });

  if (!res.ok) return;

  if (res.already) return;

  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  const member = chat.members[duty.userId];
  const adminId = chat.settings?.adminId;

  const text =
    `<b>Подтверждение дежурства</b>\n\n` +
    `Дежурный <b>${ui.escapeHtml(member?.name || "?")}</b> отметил задачи как выполненные.\n` +
    `Подтвердить?`;
  const keyboard = {
    inline_keyboard: [
      [{ text: "✅ Подтвердить", callback_data: "duty:confirm" }],
      [{ text: "❌ Отклонить", callback_data: "duty:reject" }],
    ],
  };

  if (adminId == null) {
    await bot.sendMessage(chatId, "Админ не назначен. Назначьте админа: /setadmin");
    return;
  }
  try {
    const msg = await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    dutyService.setAdminMessageId(chatId, msg.message_id);
  } catch (e) {
    logger.warn("Could not send admin confirmation to chat", chatId, e);
  }
}

/** Админ нажал "Подтвердить" */
async function handleDutyConfirm(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const res = dutyService.confirmDutyByAdmin(chatId, userId);
  await bot.answerCallbackQuery(query.id, { text: res.error || "Подтверждено 👍" });

  if (!res.ok) return;

  try {
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
  } catch (_) {}
  await bot.sendMessage(
    chatId,
    ui.confirmedCard({ name: res.member?.name || "Дежурный", points: config.points.perDuty, mode: "admin" }),
    { parse_mode: "HTML", reply_markup: ui.replyMenuKeyboard() }
  );
  const tomorrow = dutyService.getTomorrowPerson(chatId);
  if (tomorrow) {
    await bot.sendMessage(chatId, ui.tomorrowCard({ personName: tomorrow.name }), { parse_mode: "HTML" });
  }
}

/** Админ нажал "Отклонить" */
async function handleDutyReject(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const res = dutyService.rejectDutyByAdmin(chatId, userId);
  await bot.answerCallbackQuery(query.id, { text: res.error || "Отклонено" });

  if (!res.ok) return;

  try {
    await bot.editMessageText("Дежурство отклонено. Дежурный может нажать «Задачи выполнены» снова.", {
      chat_id: chatId,
      message_id: query.message.message_id,
    });
  } catch (_) {}
  await bot.sendMessage(
    chatId,
    "<b>❌ Отклонено</b>\n\nЗадачи отклонены. Нужно выполнить снова.\nКнопка «✅ Задачи выполнены» снова активна для дежурного.",
    { parse_mode: "HTML", reply_markup: ui.replyMenuKeyboard() }
  );
}

module.exports = {
  handleDutyDone,
  handleDutyConfirm,
  handleDutyReject,
};
