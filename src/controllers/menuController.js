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
    await bot.sendMessage(
      chatId,
      "🏠 *Семейный бот*\n\nДобро пожаловать! Чтобы начать, каждый участник должен написать:\n\n`/join`\n\nПосле этого откройте меню: /help",
      { parse_mode: "Markdown" }
    );
    return;
  }
  dutyService.ensureDutyForToday(chatId);
  const title = "🏠 Семейный бот";
  const subtitle = "Выберите действие:";
  await bot.sendMessage(chatId, `${title}\n\n${subtitle}`, {
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
    "🏠 *Семейный бот*\n\n📜 Команды:\n`/join` — вступить в семью\n`/today` — кто дежурный\n`/tasks` — задачи на сегодня\n`/stats` — ваша статистика\n`/setadmin` — стать админом (один на чат)\n`/help` — это меню\n\n👇 Или выберите кнопку ниже:",
    { parse_mode: "Markdown", reply_markup: mainMenuKeyboardForUser(chatId, msg.from?.id) }
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
    await bot.editMessageText("📋 *Задачи на сегодня*\n\nНет участников. Напишите /join", {
      chat_id: chatId,
      message_id: editMessageId,
      parse_mode: "Markdown",
      reply_markup: backOnlyKeyboard(),
    });
    return;
  }
  let text = `📋 *Задачи на сегодня*\n`;
  text += `👤 Дежурный: ${person.name}\n`;
  text += `\n`;
  tasks.forEach((t) => (text += `• ${t.title}\n`));
  const duty = getChat(chatId).currentDuty;
  const canMarkDone = duty && duty.status === "active" && duty.userId === userId;
  const rows = [];
  if (canMarkDone) rows.push([{ text: "✅ Задачи выполнены", callback_data: "duty:done" }]);
  rows.push([{ text: "« Назад в меню", callback_data: "menu:back" }]);
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendWhoDuty(bot, chatId, editMessageId) {
  const person = dutyService.getTodayPerson(chatId);
  const text = person
    ? `👤 *Кто дежурный*\n\nСегодня дежурный: *${person.name}*`
    : "👤 *Кто дежурный*\n\nНет участников. Напишите /join";
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "Markdown",
    reply_markup: backOnlyKeyboard(),
  });
}

async function sendStats(bot, chatId, userId, editMessageId) {
  const ratingService = require("../services/ratingService");
  const stats = ratingService.getMemberStats(chatId, userId);
  if (!stats) {
    await bot.editMessageText("📊 *Статистика*\n\nВы не в семье. Напишите /join", {
      chat_id: chatId,
      message_id: editMessageId,
      parse_mode: "Markdown",
      reply_markup: backOnlyKeyboard(),
    });
    return;
  }
  let text = `📊 *Статистика: ${stats.name}*\n\n`;
  text += `⭐ Очки: *${stats.points}*\n`;
  text += `🔥 Стрик: *${stats.streak}*\n`;
  text += `\n`;
  text += `Дежурств: ${stats.dutyCount} │ ✓ Подтверждено: ${stats.confirmedCount}\n`;
  text += `Отклонено: ${stats.rejectedCount} │ Авто: ${stats.autoConfirmedCount}\n`;
  text += `\n`;
  const badges = (stats.badges || []).join(", ") || "—";
  const streakBadges = (stats.streakBadges || []).join(", ") || "—";
  text += `🏅 Бейджи: ${badges}\n`;
  text += `🔥 Стрик-бейджи: ${streakBadges}`;
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "Markdown",
    reply_markup: backOnlyKeyboard(),
  });
}

async function sendRating(bot, chatId, editMessageId) {
  const ratingService = require("../services/ratingService");
  const rating = ratingService.getRating(chatId);
  let text = "🏆 *Рейтинг*\n\n";
  if (rating.length === 0) {
    text += "Пока никого. Напишите /join";
  } else {
    const medals = ["🥇", "🥈", "🥉"];
    rating.forEach((r, i) => {
      const medal = medals[i] || "  ";
      text += `${medal} *${r.name}* — ${r.points} очков (стрик ${r.streak})\n`;
    });
  }
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: editMessageId,
    parse_mode: "Markdown",
    reply_markup: backOnlyKeyboard(),
  });
}

async function sendAdminPanel(bot, chatId, userId, editMessageId) {
  if (!memberService.isAdmin(chatId, userId)) {
    await bot.answerCallbackQuery(editMessageId);
    return;
  }
  const text = "⚙️ *Админ-панель*\n\nУправление задачами и дежурными.";
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
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

/** menu:back — вернуть главное меню (редактируем сообщение) */
async function handleMenuBack(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  await bot.editMessageText("🏠 *Семейный бот*\n\nВыберите действие:", {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: "Markdown",
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
