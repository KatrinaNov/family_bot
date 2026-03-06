/**
 * Главное inline-меню и команда /start.
 */
const dutyService = require("../services/dutyService");
const taskService = require("../services/taskService");
const memberService = require("../services/memberService");
const { getChat } = require("../storage/storage");
const logger = require("../lib/logger");
const ui = require("../ui/ui");

function replyMenuKeyboard() {
  return ui.replyMenuKeyboard();
}

function mainMenuKeyboardForUser(chatId, userId) {
  const rows = [
    [
      { text: "📋 Задачи", callback_data: "menu:tasks" },
      { text: "👤 Дежурный", callback_data: "menu:who" },
    ],
    [
      { text: "📊 Статистика", callback_data: "menu:stats" },
      { text: "🏆 Рейтинг", callback_data: "menu:rating" },
    ],
  ];
  if (memberService.isAdmin(chatId, userId)) {
    rows.push([{ text: "⚙️ Админ-панель", callback_data: "menu:admin" }]);
  }
  return { inline_keyboard: rows };
}

/** Кнопка « Назад» для подстраниц (без дублирования в главном меню) */
function backOnlyKeyboard() {
  return { inline_keyboard: [[{ text: "« Назад в меню", callback_data: "menu:back" }]] };
}

/**
 * Обработка /start: приветствие и создание дежурства при необходимости.
 */
async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const chat = getChat(chatId);
  if (!chat.schedule?.order?.length) {
    await bot.sendMessage(chatId, ui.homeCard({ hasFamily: false }), {
      parse_mode: "HTML",
      reply_markup: replyMenuKeyboard(),
      disable_web_page_preview: true,
    });
    return;
  }
  dutyService.ensureDutyForToday(chatId);
  await bot.sendMessage(chatId, ui.homeCard({ hasFamily: true }), {
    parse_mode: "HTML",
    reply_markup: replyMenuKeyboard(),
  });
}

/**
 * Обработка /help и показ меню.
 */
async function handleHelp(bot, msg) {
  const chatId = msg.chat.id;
  const chat = getChat(chatId);
  await bot.sendMessage(
    chatId,
    ui.helpCard({ adminIsSet: chat.settings?.adminId != null }),
    { parse_mode: "HTML", reply_markup: replyMenuKeyboard(), disable_web_page_preview: true }
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
    await bot.editMessageText("<b>📋 Задачи на сегодня</b>\n\nНет участников. Нажмите «ℹ️ Помощь».", {
      chat_id: chatId,
      message_id: editMessageId,
      parse_mode: "HTML",
      reply_markup: backOnlyKeyboard(),
    });
    return;
  }
  const text = ui.tasksCard({ dateStr: today, personName: person.name, tasks });
  const duty = getChat(chatId).currentDuty;
  const canMarkDone = duty && duty.status === "active" && duty.userId === userId;
  const rows = [];
  if (canMarkDone) rows.push([{ text: "✅ Задачи выполнены", callback_data: "duty:done" }]);
  rows.push([{ text: "« Назад в меню", callback_data: "menu:back" }]);
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendWhoDuty(bot, chatId, editMessageId) {
  const person = dutyService.getTodayPerson(chatId);
  const text = ui.whoCard({ personName: person?.name });
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "HTML",
    reply_markup: backOnlyKeyboard(),
  });
}

async function sendStats(bot, chatId, userId, editMessageId) {
  const ratingService = require("../services/ratingService");
  const stats = ratingService.getMemberStats(chatId, userId);
  if (!stats) {
    await bot.editMessageText(ui.statsCard(null), {
      chat_id: chatId,
      message_id: editMessageId,
      parse_mode: "HTML",
      reply_markup: backOnlyKeyboard(),
    });
    return;
  }
  const text = ui.statsCard(stats);
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "HTML",
    reply_markup: backOnlyKeyboard(),
  });
}

async function sendRating(bot, chatId, editMessageId) {
  const ratingService = require("../services/ratingService");
  const rating = ratingService.getRating(chatId);
  const text = ui.ratingCard(rating);
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "HTML",
    reply_markup: backOnlyKeyboard(),
  });
}

async function sendAdminPanel(bot, chatId, userId, editMessageId) {
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(editMessageId);
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
      [{ text: "« Назад в меню", callback_data: "menu:back" }],
    ],
  };
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

/** menu:back — вернуть главное меню (редактируем сообщение) */
async function handleMenuBack(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  await bot.editMessageText(ui.homeCard({ hasFamily: true }), {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: "HTML",
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
  replyMenuKeyboard,
};
