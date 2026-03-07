/**
 * Сервис дежурств: создание, отправка на подтверждение, подтверждение/отклонение, авто-подтверждение в 23:00.
 * Статусы: active (ожидает нажатия "Задачи выполнены") | pending_confirmation | confirmed | rejected
 */
const { getChat, updateChat } = require("../storage/storage");
const { getTasksForDate, markTasksCompletedOn } = require("./taskService");
const { getMember, updateBadges } = require("./memberService");
const config = require("../../config");
const logger = require("../lib/logger");

function getTodayDateStr() {
  return new Date().toISOString().split("T")[0];
}

/** Текущий дежурный по расписанию */
function getTodayPerson(chatId) {
  const chat = getChat(chatId);
  const order = chat.schedule?.order || [];
  if (order.length === 0) return null;
  const idx = (chat.schedule.currentIndex || 0) % order.length;
  return chat.members[order[idx]] || null;
}

/** Кто будет дежурным завтра (по кругу), не меняя состояние */
function getTomorrowPerson(chatId) {
  const chat = getChat(chatId);
  const order = chat.schedule?.order || [];
  if (order.length === 0) return null;
  const idx = ((chat.schedule.currentIndex || 0) + 1) % order.length;
  return chat.members[order[idx]] || null;
}

/**
 * Создать дежурство на сегодня, если его ещё нет.
 * Возвращает currentDuty или null.
 */
function ensureDutyForToday(chatId) {
  const chat = getChat(chatId);
  const today = getTodayDateStr();
  // Миграция: старый формат с duty.tasks вместо duty.taskIds — пересоздаём
  if (chat.currentDuty && chat.currentDuty.date === today) {
    if (chat.currentDuty.status === "pending_confirmation") return chat.currentDuty;
    if (chat.currentDuty.status === "confirmed") return chat.currentDuty;
    if (chat.currentDuty.status === "active" && Array.isArray(chat.currentDuty.taskIds)) return chat.currentDuty;
  }
  // Если дежурство на другой день или уже завершено — переключаем и создаём новое
  if (chat.currentDuty && chat.currentDuty.date !== today) {
    const prev = chat.currentDuty;
    const member = chat.members?.[prev.userId];

    // Надёжность после перезапуска: если вчера был pending_confirmation и мы не успели сделать авто-подтверждение,
    // считаем выполненным автоматически при первом запуске на следующий день.
    if (prev.status === "pending_confirmation" && member) {
      prev.status = "confirmed";
      prev.resolvedBy = "auto_rollover";
      const points = config.points.perDuty;
      member.stats.points += points;
      member.stats.streak = (member.stats.streak || 0) + 1;
      member.stats.dutyCount = (member.stats.dutyCount || 0) + 1;
      member.stats.autoConfirmedCount = (member.stats.autoConfirmedCount || 0) + 1;
      updateBadges(member);
      markTasksCompletedOn(chatId, prev.date, prev.taskIds || []);
    }

    // Если вчерашнее дежурство так и не было отмечено (active) — считаем пропущенным, сбрасываем стрик.
    if (prev.status === "active" && member) {
      member.stats.streak = 0;
      member.stats.missedCount = (member.stats.missedCount || 0) + 1;
      updateBadges(member);
    }

    chat.history = chat.history || [];
    chat.history.push(prev);
    chat.currentDuty = null;
    chat.schedule.currentIndex = (chat.schedule.currentIndex || 0) + 1;
  }
  // Важно: брать дежурного из уже изменённого chat (с новым currentIndex), а не из getChat(),
  // иначе getTodayPerson(chatId) загрузит данные с диска со старым index и вернёт вчерашнего дежурного.
  const order = chat.schedule?.order || [];
  const idx = (chat.schedule.currentIndex || 0) % order.length;
  const person = chat.members[order[idx]] || null;
  if (!person) return null;

  const taskList = getTasksForDate(chatId, today);
  // Миграция: старый currentDuty мог иметь tasks[] с полями text/done — заменяем на taskIds
  chat.currentDuty = {
    date: today,
    userId: person.id,
    status: "active",
    taskIds: taskList.map((t) => t.id),
    submittedAt: null,
    confirmationMessageId: null,
    adminMessageId: null,
  };
  updateChat(chatId, chat);
  return chat.currentDuty;
}

/**
 * Дежурный нажал "Задачи выполнены" → статус pending_confirmation, уведомление админу.
 * Idempotent: если уже pending_confirmation, возвращаем success без изменений.
 */
function submitDutyForConfirmation(chatId, userId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty || duty.date !== getTodayDateStr()) {
    return { ok: false, error: "Нет активного дежурства на сегодня" };
  }
  if (duty.userId !== userId) {
    return { ok: false, error: "Только дежурный может отметить выполнение" };
  }
  if (duty.status === "pending_confirmation") {
    return { ok: true, already: true };
  }
  if (duty.status !== "active") {
    return { ok: false, error: "Дежурство уже обработано" };
  }
  duty.status = "pending_confirmation";
  duty.submittedAt = new Date().toISOString();
  updateChat(chatId, chat);
  return { ok: true, duty };
}

/**
 * Админ подтвердил → confirmed, начисление баллов, уведомление дежурному.
 */
function confirmDutyByAdmin(chatId, adminUserId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty || duty.status !== "pending_confirmation") {
    return { ok: false, error: "Нет дежурства, ожидающего подтверждения" };
  }
  if (chat.settings?.adminId !== adminUserId) {
    return { ok: false, error: "Только админ может подтвердить" };
  }

  duty.status = "confirmed";
  duty.confirmedAt = new Date().toISOString();
  duty.resolvedBy = "admin";
  const member = chat.members[duty.userId];
  const points = config.points.perDuty;
  member.stats.points += points;
  member.stats.streak = (member.stats.streak || 0) + 1;
  member.stats.dutyCount = (member.stats.dutyCount || 0) + 1;
  member.stats.confirmedCount = (member.stats.confirmedCount || 0) + 1;
  updateBadges(member);

  markTasksCompletedOn(chatId, duty.date, duty.taskIds);
  updateChat(chatId, chat);
  return { ok: true, member, points };
}

/**
 * Админ отклонил → rejected, дежурному уведомление, дежурство снова active (кнопка снова активна).
 */
function rejectDutyByAdmin(chatId, adminUserId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty || duty.status !== "pending_confirmation") {
    return { ok: false, error: "Нет дежурства, ожидающего подтверждения" };
  }
  if (chat.settings?.adminId !== adminUserId) {
    return { ok: false, error: "Только админ может отклонить" };
  }

  const member = chat.members[duty.userId];
  member.stats.rejectedCount = (member.stats.rejectedCount || 0) + 1;
  member.stats.streak = 0;

  duty.status = "active";
  duty.submittedAt = null;
  duty.confirmationMessageId = null;
  duty.adminMessageId = null;
  updateChat(chatId, chat);
  updateBadges(member);
  return { ok: true, member };
}

/**
 * Авто-подтверждение в 23:00: все pending_confirmation по всем чатам → confirmed, баллы.
 * Обрабатываем каждый чат через getChat/updateChat, чтобы не было гонок с сохранением.
 */
function autoConfirmPendingDuties() {
  const { load } = require("../storage/storage");
  const data = load();
  const today = getTodayDateStr();
  const results = [];

  for (const chatId of Object.keys(data.chats || {})) {
    const chat = getChat(chatId);
    const duty = chat.currentDuty;
    if (!duty || duty.date !== today || duty.status !== "pending_confirmation") continue;

    duty.status = "confirmed";
    duty.confirmedAt = new Date().toISOString();
    duty.resolvedBy = "auto";
    const member = chat.members[duty.userId];
    if (member) {
      const points = config.points.perDuty;
      member.stats.points += points;
      member.stats.streak = (member.stats.streak || 0) + 1;
      member.stats.dutyCount = (member.stats.dutyCount || 0) + 1;
      member.stats.autoConfirmedCount = (member.stats.autoConfirmedCount || 0) + 1;
      updateBadges(member);
    }
    markTasksCompletedOn(chatId, duty.date, duty.taskIds || []);
    updateChat(chatId, chat);
    results.push({ chatId, userId: duty.userId });
  }
  return results;
}

/**
 * Сохранить messageId сообщения админу (для редактирования кнопок после подтверждения/отклонения).
 */
function setAdminMessageId(chatId, messageId) {
  const chat = getChat(chatId);
  if (chat.currentDuty) {
    chat.currentDuty.adminMessageId = messageId;
    updateChat(chatId, chat);
  }
}

/**
 * Ручная смена дежурного (админ): переключаем currentIndex и пересоздаём duty на сегодня.
 */
function setNextDutyManually(chatId) {
  const chat = getChat(chatId);
  const order = chat.schedule?.order || [];
  if (order.length === 0) return { ok: false, error: "Нет участников" };
  chat.schedule.currentIndex = (chat.schedule.currentIndex || 0) + 1;
  chat.currentDuty = null;
  updateChat(chatId, chat);
  ensureDutyForToday(chatId);
  return { ok: true, person: getTodayPerson(chatId) };
}

module.exports = {
  getTodayPerson,
  getTomorrowPerson,
  getTodayDateStr,
  ensureDutyForToday,
  submitDutyForConfirmation,
  confirmDutyByAdmin,
  rejectDutyByAdmin,
  autoConfirmPendingDuties,
  setAdminMessageId,
  setNextDutyManually,
};
