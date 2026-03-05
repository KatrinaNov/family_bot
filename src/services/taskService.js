/**
 * Сервис задач: получение списка задач на дату с учётом периодичности.
 * Задача: id, title, description, intervalType, intervalValue, lastCompletedDate, points.
 */
const { getChat, updateChat } = require("../storage/storage");
const config = require("../../config");

const INTERVAL_TYPES = ["daily", "weekly", "biweekly", "custom"];

/**
 * Проверяет, должна ли задача быть выполнена на указанную дату.
 * @param {Object} task - { intervalType, intervalValue, lastCompletedDate }
 * @param {string} dateStr - YYYY-MM-DD
 */
function isTaskDueOn(task, dateStr) {
  const last = task.lastCompletedDate || null;
  const d = new Date(dateStr + "T12:00:00Z");

  switch (task.intervalType) {
    case "daily":
      return true;
    case "weekly":
      if (!last) return true;
      const lastW = new Date(last + "T12:00:00Z");
      const diffDays = (d - lastW) / (24 * 60 * 60 * 1000);
      return diffDays >= 7;
    case "biweekly":
      if (!last) return true;
      const lastB = new Date(last + "T12:00:00Z");
      const diffB = (d - lastB) / (24 * 60 * 60 * 1000);
      return diffB >= 14;
    case "custom":
      if (!last) return true;
      const lastC = new Date(last + "T12:00:00Z");
      const diffC = (d - lastC) / (24 * 60 * 60 * 1000);
      return diffC >= (task.intervalValue || 1);
    default:
      return true;
  }
}

/**
 * Получить список задач на дату для чата (с учётом периодичности).
 */
function getTasksForDate(chatId, dateStr) {
  const chat = getChat(chatId);
  let tasks = chat.tasks && chat.tasks.length ? chat.tasks : migrateDefaultTasks(chatId);
  return tasks.filter((t) => isTaskDueOn(t, dateStr));
}

/** Миграция: если в чате нет задач, создаём из config.defaultTasks */
function migrateDefaultTasks(chatId) {
  const chat = getChat(chatId);
  if (chat.tasks && chat.tasks.length > 0) return chat.tasks;
  const tasks = config.defaultTasks.map((t, i) => ({
    id: `task_${Date.now()}_${i}`,
    title: t.title,
    description: t.description || "",
    intervalType: t.intervalType || "daily",
    intervalValue: t.intervalValue ?? 1,
    lastCompletedDate: null,
    points: t.points ?? 1,
  }));
  chat.tasks = tasks;
  updateChat(chatId, chat);
  return tasks;
}

/**
 * Сгенерировать следующий id задачи.
 */
function nextTaskId(chatId) {
  const chat = getChat(chatId);
  const tasks = chat.tasks || [];
  const numeric = tasks.filter((t) => /^task_\d+$/.test(String(t.id))).length;
  return `task_${Date.now()}_${numeric}`;
}

/**
 * Добавить задачу (админ).
 */
function addTask(chatId, { title, description = "", intervalType = "daily", intervalValue = 1, points = 1 }) {
  const chat = getChat(chatId);
  if (!chat.tasks) chat.tasks = [];
  const task = {
    id: nextTaskId(chatId),
    title,
    description,
    intervalType: INTERVAL_TYPES.includes(intervalType) ? intervalType : "daily",
    intervalValue: Math.max(1, parseInt(intervalValue, 10) || 1),
    lastCompletedDate: null,
    points: Math.max(0, parseInt(points, 10) || 1),
  };
  chat.tasks.push(task);
  updateChat(chatId, chat);
  return task;
}

/**
 * Обновить задачу по id.
 */
function updateTask(chatId, taskId, updates) {
  const chat = getChat(chatId);
  const task = (chat.tasks || []).find((t) => String(t.id) === String(taskId));
  if (!task) return null;
  if (updates.title !== undefined) task.title = updates.title;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.intervalType !== undefined) task.intervalType = updates.intervalType;
  if (updates.intervalValue !== undefined) task.intervalValue = updates.intervalValue;
  if (updates.points !== undefined) task.points = updates.points;
  updateChat(chatId, chat);
  return task;
}

/**
 * Удалить задачу по id.
 */
function deleteTask(chatId, taskId) {
  const chat = getChat(chatId);
  if (!chat.tasks) return false;
  const idx = chat.tasks.findIndex((t) => String(t.id) === String(taskId));
  if (idx === -1) return false;
  chat.tasks.splice(idx, 1);
  updateChat(chatId, chat);
  return true;
}

/**
 * Отметить задачи как выполненные на дату (обновить lastCompletedDate для выданных задач).
 */
function markTasksCompletedOn(chatId, dateStr, taskIds) {
  const chat = getChat(chatId);
  const tasks = chat.tasks || [];
  taskIds.forEach((id) => {
    const t = tasks.find((x) => String(x.id) === String(id));
    if (t) t.lastCompletedDate = dateStr;
  });
  updateChat(chatId, chat);
}

/**
 * Получить все задачи чата (для админки).
 */
function getAllTasks(chatId) {
  const chat = getChat(chatId);
  return chat.tasks || migrateDefaultTasks(chatId);
}

module.exports = {
  getTasksForDate,
  getAllTasks,
  addTask,
  updateTask,
  deleteTask,
  markTasksCompletedOn,
  isTaskDueOn,
  INTERVAL_TYPES,
};
