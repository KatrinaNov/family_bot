/**
 * Обработка кнопки "Задачи выполнены", подтверждение/отклонение админом.
 * Idempotent: повторное нажатие не создаёт дубликаты.
 */
const { getChat } = require("../storage/storage");
const dutyService = require("../services/dutyService");
const memberService = require("../services/memberService");
const logger = require("../lib/logger");

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

  const text = `Дежурный ${member?.name || "?"} отметил задачи как выполненные.\nПодтвердить?`;
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
    const msg = await bot.sendMessage(chatId, text, { reply_markup: keyboard });
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
  await bot.sendMessage(chatId, `${res.member?.name || "Дежурный"}, задачи подтверждены 👍 Баллы начислены.`);
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
  await bot.sendMessage(chatId, "Задачи отклонены ❗ Нужно выполнить снова. Кнопка «Задачи выполнены» снова активна для дежурного.");
}

module.exports = {
  handleDutyDone,
  handleDutyConfirm,
  handleDutyReject,
};
