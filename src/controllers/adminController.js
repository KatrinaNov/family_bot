/**
 * Админ-панель: добавление/редактирование/удаление задач, смена дежурного.
 * Доступ только для единственного админа (settings.adminId) в настройках чата.
 */
const taskService = require("../services/taskService");
const dutyService = require("../services/dutyService");
const memberService = require("../services/memberService");
const logger = require("../lib/logger");

/** admin:add_task — показать подсказку "Введите название задачи" или инлайн-форму (упрощённо: добавляем задачу по умолчанию) */
async function handleAdminAddTask(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(query.id, { text: "Доступ только для админа", show_alert: true });
    return;
  }
  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(
    chatId,
    "Введите новую задачу в формате:\n<название> | <daily|weekly|biweekly|custom> | <число для custom>\nПример: 🧹 Пылесос | weekly | 7"
  );
  // Состояние "ожидаю ввод задачи" можно хранить в памяти по chatId (или в storage). Для простоты — следующий текст от этого пользователя считаем задачей.
  // Упрощённо: кнопка "Добавить задачу по умолчанию"
  await bot.sendMessage(chatId, "Или выберите шаблон:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Пылесос (еженедельно)", callback_data: "admin:quick_add:vacuum" }],
        [{ text: "➕ Мытьё полов (еженедельно)", callback_data: "admin:quick_add:floor" }],
        [{ text: "➕ Мусор (ежедневно)", callback_data: "admin:quick_add:trash" }],
        [{ text: "◀ Назад", callback_data: "menu:admin" }],
      ],
    },
  });
}

const QUICK_TASKS = {
  vacuum: { title: "🧹 Пылесос", intervalType: "weekly", intervalValue: 7 },
  floor: { title: "🪣 Мытьё полов", intervalType: "weekly", intervalValue: 7 },
  trash: { title: "🗑 Собрать мусор", intervalType: "daily", intervalValue: 1 },
};

/** admin:quick_add:key */
async function handleAdminQuickAddTask(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  const key = query.data.split(":")[2];
  const preset = QUICK_TASKS[key];
  if (!preset) {
    await bot.answerCallbackQuery(query.id, { text: "Неизвестный шаблон" });
    return;
  }
  const task = taskService.addTask(chatId, preset);
  await bot.answerCallbackQuery(query.id, { text: "Задача добавлена" });
  await bot.editMessageText(`Добавлена задача: ${task.title} (${preset.intervalType})`, {
    chat_id: chatId,
    message_id: query.message.message_id,
  });
}

/** admin:list_tasks — список задач с кнопками редактировать/удалить */
async function handleAdminListTasks(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  const tasks = taskService.getAllTasks(chatId);
  let text = "📝 Список задач\n\n";
  const rows = [];
  tasks.forEach((t, i) => {
    text += `${i + 1}. ${t.title} (${t.intervalType})\n`;
    rows.push([
      { text: `✏️ ${t.title.substring(0, 20)}`, callback_data: `admin:edit:${t.id}` },
      { text: "🗑", callback_data: `admin:del:${t.id}` },
    ]);
  });
  rows.push([{ text: "◀ В админку", callback_data: "menu:admin" }]);
  await bot.editMessageText(text || "Нет задач.", {
    chat_id: chatId,
    message_id: query.message.message_id,
    reply_markup: { inline_keyboard: rows },
  });
  await bot.answerCallbackQuery(query.id);
}

/** admin:del:taskId */
async function handleAdminDeleteTask(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  const taskId = query.data.split(":")[2];
  const ok = taskService.deleteTask(chatId, taskId);
  await bot.answerCallbackQuery(query.id, { text: ok ? "Задача удалена" : "Не найдена" });
  await handleAdminListTasks(bot, query);
}

/** admin:edit:taskId — упрощённо: только смена типа; полное редактирование через команды */
async function handleAdminEditTask(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  const taskId = query.data.split(":")[2];
  const tasks = taskService.getAllTasks(chatId);
  const task = tasks.find((t) => String(t.id) === String(taskId));
  if (!task) {
    await bot.answerCallbackQuery(query.id, { text: "Задача не найдена" });
    return;
  }
  await bot.answerCallbackQuery(query.id);
  const keyboard = {
    inline_keyboard: [
      [
        { text: "daily", callback_data: `admin:set_interval:${taskId}:daily:1` },
        { text: "weekly", callback_data: `admin:set_interval:${taskId}:weekly:7` },
      ],
      [
        { text: "biweekly", callback_data: `admin:set_interval:${taskId}:biweekly:14` },
        { text: "◀ Назад", callback_data: "admin:list_tasks" },
      ],
    ],
  };
  await bot.editMessageText(`Редактировать: ${task.title}\nВыберите периодичность:`, {
    chat_id: chatId,
    message_id: query.message.message_id,
    reply_markup: keyboard,
  });
}

/** admin:set_interval:taskId:type:value */
async function handleAdminSetInterval(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  const [, , taskId, intervalType, intervalValue] = query.data.split(":");
  taskService.updateTask(chatId, taskId, { intervalType, intervalValue: parseInt(intervalValue, 10) || 1 });
  await bot.answerCallbackQuery(query.id, { text: "Периодичность обновлена" });
  query.data = "admin:list_tasks";
  await handleAdminListTasks(bot, query);
}

/** admin:next_duty — смена дежурного вручную */
async function handleAdminNextDuty(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  const res = dutyService.setNextDutyManually(chatId);
  await bot.answerCallbackQuery(query.id, { text: res.error || "Дежурный сменён" });
  if (res.ok && res.person) {
    await bot.editMessageText(`Дежурный сменён. Теперь дежурный: ${res.person.name}`, {
      chat_id: chatId,
      message_id: query.message.message_id,
    });
  }
}

/** Назначить текущего пользователя единственным админом. Возвращает true | "already" | false (не в семье). */
async function handleSetAdmin(bot, chatId, userId) {
  const member = memberService.getMember(chatId, userId);
  if (!member) return false;
  const wasSet = memberService.setAdmin(chatId, userId);
  return wasSet ? true : "already";
}

module.exports = {
  handleAdminAddTask,
  handleAdminQuickAddTask,
  handleAdminListTasks,
  handleAdminDeleteTask,
  handleAdminEditTask,
  handleAdminSetInterval,
  handleAdminNextDuty,
  handleSetAdmin,
};
