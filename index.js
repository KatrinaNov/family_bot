require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");

const { addMember } = require("./members");
const {
  getTodayPerson,
  createDuty,
  nextDuty,
  markTaskDone,
  confirmDuty,
  checkAndCompleteDuty
} = require("./duty");
const { getChat } = require("./storage");
const config = require("./config");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

/* /start */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`🏠 Семейный бот активирован

Каждый участник должен написать:
/join

Для помощи по командам используйте:
/help`);
});

/* /help */
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
`📜 Доступные команды:
/join - присоединиться к семье
/today - узнать, кто дежурит сегодня
/stats - показать статистику
/tasks - посмотреть и отметить задачи текущего дежурного
/help - показать это сообщение`);
});

/* /join */
bot.onText(/\/join/, (msg) => {
  const added = addMember(msg.chat.id, msg.from);

  if (added) {
    bot.sendMessage(msg.chat.id, `${msg.from.first_name} добавлен в семью 👌`);
  } else {
    bot.sendMessage(msg.chat.id, `Ты уже в семье 😈`);
  }
});

/* /today */
bot.onText(/\/today/, (msg) => {
  const person = getTodayPerson(msg.chat.id);
  if (!person) {
    bot.sendMessage(msg.chat.id, "Нет участников");
    return;
  }

  bot.sendMessage(msg.chat.id, `Сегодня дежурит: ${person.name}`);
});

/* /stats — показать очки, стрик и бейджи */
bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    const chat = getChat(chatId);
    const member = chat.members[msg.from.id];
    if (!member) {
      bot.sendMessage(chatId, "Вы не в семье. Используйте /join");
      return;
    }
  
    let text = `📊 Статистика ${member.name}:\n`;
    text += `Очки: ${member.stats.points}\n`;
    text += `Стрик: ${member.stats.streak}\n`;
    text += `Бейджи: ${member.stats.badges.join(", ") || "нет"}\n`;
    text += `Стрик-бейджи: ${member.stats.streakBadges.join(", ") || "нет"}`;
  
    bot.sendMessage(chatId, text);
  });

/* /tasks — посмотреть и взаимодействовать с задачами */
bot.onText(/\/tasks/, (msg) => {
  sendDutyMessage(msg.chat.id);
});

/* Inline кнопки для задач и подтверждений */
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data.split(":"); // task:1 или confirm или unmark:1

  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty) {
    bot.answerCallbackQuery(query.id, { text: "Нет активного дежурства", show_alert: true });
    return;
  }

  // Дежурный отмечает задачу
  if (data[0] === "task") {
    const taskId = parseInt(data[1]);
    const res = markTaskDone(chatId, taskId, userId);
    bot.answerCallbackQuery(query.id, { text: res.error || "Задача отмечена ✅" });
    sendDutyMessage(chatId);
  }

  // Дежурный снимает отметку (если кто-то поставил "не выполнено")
  if (data[0] === "unmark") {
    const taskId = parseInt(data[1]);
    const task = duty.tasks.find(t => t.id === taskId);
    if (task && duty.userId === userId) {
      task.done = false;
      require("./storage").updateChat(chatId, chat);
      bot.answerCallbackQuery(query.id, { text: "Отметка снята ⬜️" });
      sendDutyMessage(chatId);
    } else {
      bot.answerCallbackQuery(query.id, { text: "Не получилось снять отметку", show_alert: true });
    }
  }

  // Другие участники подтверждают или снимают
  if (data[0] === "confirm") {
    const res = confirmDuty(chatId, userId);
    bot.answerCallbackQuery(query.id, { text: res.error || "Подтверждено 👍" });
    // проверяем завершение
    const completed = checkAndCompleteDutyWithPoints(chatId);
    sendDutyMessage(chatId);
    if (completed) {
      bot.sendMessage(chatId, `🎉 Дежурство завершено! ${getTodayPerson(chatId)?.name || "Новый герой"} получил очки!`);
    }
  }

  // Другой участник снимает отметку
  if (data[0] === "unconfirm") {
    const index = duty.confirmations.indexOf(userId);
    if (index !== -1) duty.confirmations.splice(index, 1);
    require("./storage").updateChat(chatId, chat);
    bot.answerCallbackQuery(query.id, { text: "Подтверждение снято 👎" });
    sendDutyMessage(chatId);
  }
});

/* Отправка сообщения с задачами */
function sendDutyMessage(chatId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty) return;

  const person = chat.members[duty.userId];
  if (!person) return;

  let text = `☀️ Сегодня дежурит: ${person.name}\n\n`;
  duty.tasks.forEach(t => {
    text += `• ${t.done ? "✅" : "⬜️"} ${t.text}\n`;
  });
  text += `\nПодтверждения семьи: ${duty.confirmations.length}`;

  const buttons = [];

  // Дежурный: отметить задачи
  duty.tasks.forEach(t => {
    if (!t.done && duty.userId === person.id) {
      buttons.push([{ text: `✅ ${t.text}`, callback_data: `task:${t.id}` }]);
    }
    if (t.done && duty.userId === person.id) {
      buttons.push([{ text: `⬜️ ${t.text} (снять)`, callback_data: `unmark:${t.id}` }]);
    }
  });

  // Кнопка подтверждения для других участников
  for (const memberId in chat.members) {
    if (parseInt(memberId) !== duty.userId) {
      if (!duty.confirmations.includes(parseInt(memberId))) {
        buttons.push([{ text: `👍 Подтверждаю (${chat.members[memberId].name})`, callback_data: "confirm" }]);
      } else {
        buttons.push([{ text: `👎 Снять подтверждение (${chat.members[memberId].name})`, callback_data: "unconfirm" }]);
      }
    }
  }

  bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } });
}

/* Утренний cron — создаем дежурство и отправляем задачи */
cron.schedule("30 9 * * *", () => {
  const data = require("./storage").load();
  for (let chatId in data.chats) {
    const duty = createDuty(chatId);
    if (!duty) continue;
    sendDutyMessage(chatId);
  }
}, { timezone: config.timezone });

/* Вечерний cron — переключаем дежурного */
cron.schedule("0 21 * * *", () => {
  const data = require("./storage").load();
  for (let chatId in data.chats) {
    nextDuty(chatId);
    bot.sendMessage(chatId, "🔁 День завершен. Завтра новый герой 😈");
  }
}, { timezone: config.timezone });

/* Автоматическое завершение дежурства после 23:00 */
cron.schedule("0 23 * * *", () => {
  const data = require("./storage").load();
  for (let chatId in data.chats) {
    checkAndCompleteDutyWithPoints(chatId);
  }
}, { timezone: config.timezone });

/* Функция для начисления очков и стрика */
function checkAndCompleteDutyWithPoints(chatId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty || duty.status !== "active") return false;

  const now = new Date();
  const autoConfirm = now.getHours() >= 12;
  const confirmations = duty.confirmations.length;

  if (confirmations >= config.minConfirmations || autoConfirm) {
    duty.status = "completed";

    const member = chat.members[duty.userId];
    const allDone = duty.tasks.every(t => t.done);

    if (allDone) {
      member.stats.points += config.points.full;
      member.stats.streak += 1;
    } else if (duty.tasks.some(t => t.done)) {
      member.stats.points += config.points.partial;
      member.stats.streak = 0;
    } else {
      member.stats.points -= config.points.fineNormal;
      member.stats.streak = 0;
    }

    chat.history.push(duty);
    chat.currentDuty = null;
    nextDuty(chatId);
    require("./storage").updateChat(chatId, chat);
    return true;
  }
  return false;
}

/* Keep alive для Render */
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot alive"));
app.listen(PORT, () => console.log("Server running"));

console.log("🤖 Family Bot v3 started — с задачами, подтверждениями и очками 🎯");