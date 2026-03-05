/**
 * Главное inline-меню и команда /start.
 */
const dutyService = require("../services/dutyService");
const taskService = require("../services/taskService");
const memberService = require("../services/memberService");
const { getChat } = require("../storage/storage");
const logger = require("../lib/logger");

function mainMenuKeyboardForUser(chatId, userId) {
  const rows = [
    [{ text: "📋 Сегодняшние задачи", callback_data: "menu:tasks" }],
    [{ text: "👤 Кто дежурный", callback_data: "menu:who" }],
    [{ text: "📊 Статистика", callback_data: "menu:stats" }],
    [{ text: "🏆 Рейтинг", callback_data: "menu:rating" }],
  ];
  if (memberService.isAdmin(chatId, userId)) {
    rows.push([{ text: "⚙ Админ-панель", callback_data: "menu:admin" }]);
  }
  return { inline_keyboard: rows };
}

/**
 * Обработка /start: приветствие и создание дежурства при необходимости.
 */
async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const chat = getChat(chatId);
  if (!chat.schedule?.order?.length) {
    await bot.sendMessage(
      chatId,
      `🏠 Семейный бот активирован\n\nКаждый участник должен написать:\n/join\n\nДля помощи: /help`
    );
    return;
  }
  dutyService.ensureDutyForToday(chatId);
  await bot.sendMessage(chatId, "🏠 Семейный бот", {
    reply_markup: mainMenuKeyboardForUser(chatId, msg.from?.id),
  });
}

/**
 * Обработка /help и показ меню.
 */
async function handleHelp(bot, msg) {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    "📜 Команды:\n/join — присоединиться к семье\n/today — кто дежурит сегодня\n/stats — статистика\n/tasks — задачи на сегодня\n/help — это сообщение\n\nИли используйте меню ниже 👇",
    { reply_markup: mainMenuKeyboardForUser(chatId, msg.from?.id) }
  );
}

/**
 * Обработка callback menu:* — показать соответствующий экран или подменю.
 */
async function handleMenuCallback(bot, query, data) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const action = data[1];

  const handlers = {
    tasks: () => sendTodayTasks(bot, chatId, userId, query.message.message_id),
    who: () => sendWhoDuty(bot, chatId, query.message.message_id),
    stats: () => sendStats(bot, chatId, userId, query.message.message_id),
    rating: () => sendRating(bot, chatId, query.message.message_id),
    admin: () => sendAdminPanel(bot, chatId, userId, query.message.message_id),
  };
  const fn = handlers[action];
  if (fn) await fn();
  try {
    await bot.answerCallbackQuery(query.id);
  } catch (e) {
    logger.debug("answerCallbackQuery", e);
  }
}

async function sendTodayTasks(bot, chatId, userId, editMessageId) {
  dutyService.ensureDutyForToday(chatId);
  const today = dutyService.getTodayDateStr();
  const person = dutyService.getTodayPerson(chatId);
  const tasks = taskService.getTasksForDate(chatId, today);
  if (!person) {
    await bot.editMessageText("Нет участников. Используйте /join.", { chat_id: chatId, message_id: editMessageId });
    return;
  }
  let text = `📋 Сегодняшние задачи\nДежурный: ${person.name}\n\n`;
  tasks.forEach((t) => (text += `• ${t.title}\n`));
  const duty = getChat(chatId).currentDuty;
  const canMarkDone = duty && duty.status === "active" && duty.userId === userId;
  const keyboard = {
    inline_keyboard: canMarkDone
      ? [[{ text: "✅ Задачи выполнены", callback_data: "duty:done" }], [{ text: "◀ В меню", callback_data: "menu:back" }]]
      : [[{ text: "◀ В меню", callback_data: "menu:back" }]],
  };
  await bot.editMessageText(text, { chat_id: chatId, message_id: editMessageId, reply_markup: keyboard });
}

async function sendWhoDuty(bot, chatId, editMessageId) {
  const person = dutyService.getTodayPerson(chatId);
  const text = person ? `👤 Сегодня дежурный: ${person.name}` : "Нет участников.";
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    reply_markup: { inline_keyboard: [[{ text: "◀ В меню", callback_data: "menu:back" }]] },
  });
}

async function sendStats(bot, chatId, userId, editMessageId) {
  const ratingService = require("../services/ratingService");
  const stats = ratingService.getMemberStats(chatId, userId);
  if (!stats) {
    await bot.editMessageText("Вы не в семье. /join", { chat_id: chatId, message_id: editMessageId });
    return;
  }
  let text = `📊 Статистика: ${stats.name}\n\n`;
  text += `Очки: ${stats.points}\n`;
  text += `Стрик: ${stats.streak}\n`;
  text += `Был дежурным: ${stats.dutyCount}\n`;
  text += `Подтверждено: ${stats.confirmedCount}\n`;
  text += `Отклонено: ${stats.rejectedCount}\n`;
  text += `Авто-подтверждений: ${stats.autoConfirmedCount}\n`;
  text += `Бейджи: ${(stats.badges || []).join(", ") || "нет"}\n`;
  text += `Стрик-бейджи: ${(stats.streakBadges || []).join(", ") || "нет"}`;
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    reply_markup: { inline_keyboard: [[{ text: "◀ В меню", callback_data: "menu:back" }]] },
  });
}

async function sendRating(bot, chatId, editMessageId) {
  const ratingService = require("../services/ratingService");
  const rating = ratingService.getRating(chatId);
  let text = "🏆 Рейтинг\n\n";
  rating.forEach((r, i) => {
    text += `${i + 1}. ${r.name}: ${r.points} очков (стрик ${r.streak})\n`;
  });
  if (rating.length === 0) text += "Пока никого.";
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    reply_markup: { inline_keyboard: [[{ text: "◀ В меню", callback_data: "menu:back" }]] },
  });
}

async function sendAdminPanel(bot, chatId, userId, editMessageId) {
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(editMessageId);
    return;
  }
  const text =
    "⚙ Админ-панель\n\n• Добавить задачу\n• Редактировать/удалить задачи\n• Сменить дежурного вручную";
  const keyboard = {
    inline_keyboard: [
      [{ text: "➕ Добавить задачу", callback_data: "admin:add_task" }],
      [{ text: "📝 Список задач", callback_data: "admin:list_tasks" }],
      [{ text: "🔄 Сменить дежурного", callback_data: "admin:next_duty" }],
      [{ text: "◀ В меню", callback_data: "menu:back" }],
    ],
  };
  await bot.editMessageText(text, { chat_id: chatId, message_id: editMessageId, reply_markup: keyboard });
}

/** menu:back — вернуть главное меню (редактируем сообщение) */
async function handleMenuBack(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  await bot.editMessageText("🏠 Главное меню", {
    chat_id: chatId,
    message_id: query.message.message_id,
    reply_markup: mainMenuKeyboardForUser(chatId, userId),
  });
  await bot.answerCallbackQuery(query.id);
}

module.exports = {
  handleStart,
  handleHelp,
  handleMenuCallback,
  handleMenuBack,
  mainMenuKeyboardForUser,
};
