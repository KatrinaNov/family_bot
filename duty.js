const { getChat, updateChat } = require("./storage");
const config = require("./config");

/* Определить сегодняшнего дежурного */
function getTodayPerson(chatId) {
  const chat = getChat(chatId);
  if (chat.schedule.order.length === 0) return null;
  const index = chat.schedule.currentIndex % chat.schedule.order.length;
  return chat.members[chat.schedule.order[index]];
}

/* Создать дежурство на день */
function createDuty(chatId) {
  const chat = getChat(chatId);
  const person = getTodayPerson(chatId);
  if (!person) return null;

  const today = new Date();
  const day = today.getDay(); // 0 = воскресенье, 6 = суббота

  chat.currentDuty = {
    date: today.toISOString().split("T")[0],
    userId: person.id,
    status: "active",
    tasks: config.defaultTasks
      .filter(t =>
        t.type === "daily" ||
        (t.type === "weekend" && (day === 0 || day === 6)) ||
        t.type === "one-time"
      )
      .map((t, i) => ({
        id: i + 1,
        text: t.text,
        type: t.type,
        done: false,
        assignedTo: person.id
      })),
    confirmations: []
  };

  updateChat(chatId, chat);
  return chat.currentDuty;
}

/* Отметка задачи как выполненной */
function markTaskDone(chatId, taskId, userId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty || duty.status !== "active") return { error: "Нет активного дежурства" };

  if (duty.userId !== userId) return { error: "Отметку может ставить только дежурный" };

  const task = duty.tasks.find(t => t.id === taskId);
  if (!task) return { error: "Задача не найдена" };

  task.done = true;
  updateChat(chatId, chat);
  return { success: true, task };
}

/* Подтверждение выполнения от другого участника */
function confirmDuty(chatId, userId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty || duty.status !== "active") return { error: "Нет активного дежурства" };

  if (userId === duty.userId) return { error: "Дежурный не может подтверждать сам себя" };
  if (!duty.confirmations.includes(userId)) duty.confirmations.push(userId);

  updateChat(chatId, chat);
  return { success: true };
}

/* Проверка и завершение дежурства */
function checkAndCompleteDuty(chatId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty || duty.status !== "active") return;

  const now = new Date();
  const autoConfirm = now.getHours() >= 12;
  const confirmations = duty.confirmations.length;

  if (confirmations >= config.minConfirmations || autoConfirm) {
    duty.status = "completed";
    // можно начислять очки, обновлять стрик здесь
    chat.history.push(duty);
    chat.currentDuty = null;
    nextDuty(chatId);
    updateChat(chatId, chat);
  }
}

/* Переключить дежурного */
function nextDuty(chatId) {
  const chat = getChat(chatId);
  chat.schedule.currentIndex++;
  chat.currentDuty = null;
  updateChat(chatId, chat);
}

module.exports = {
  getTodayPerson,
  createDuty,
  nextDuty,
  markTaskDone,
  confirmDuty,
  checkAndCompleteDuty
};