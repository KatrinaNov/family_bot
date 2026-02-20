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
  checkAndCompleteDutyWithPoints
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

  // При первом старте создаём дежурство, если его нет
  const chatId = msg.chat.id;
  const chat = getChat(chatId);
  if (!chat.currentDuty) {
    createDuty(chatId);
  }
});

/* /help */
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
`📜 v.4.1.1 Доступные команды:
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

  // Если дежурство ещё не создано, создаём сразу
  const chatId = msg.chat.id;
  const chat = getChat(chatId);
  if (!chat.currentDuty) {
    createDuty(chatId);
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

/* /stats */
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
  text += `Бейджи: ${member.stats.badges?.join(", ") || "нет"}\n`;
  text += `Стрик-бейджи: ${member.stats.streakBadges?.join(", ") || "нет"}`;

  bot.sendMessage(chatId, text);
});

/* /tasks */
bot.onText(/\/tasks/, (msg) => {
  const chatId = msg.chat.id;
  const chat = getChat(chatId);

  // Если дежурство ещё не создано, создаём его сразу
  if (!chat.currentDuty) {
    createDuty(chatId);
  }

  sendDutyMessage(chatId);
});

/* Inline кнопки для задач и подтверждений */
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data.split(":");

  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty) {
    bot.answerCallbackQuery(query.id, { text: "Нет активного дежурства", show_alert: true });
    return;
  }

  if (data[0] === "task") {
    const taskId = parseInt(data[1]);
    const res = markTaskDone(chatId, taskId, userId);
    bot.answerCallbackQuery(query.id, { text: res.error || "Задача отмечена ✅" });
    sendDutyMessage(chatId);
  }

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

  if (data[0] === "confirm") {
    const res = confirmDuty(chatId, userId);
    bot.answerCallbackQuery(query.id, { text: res.error || "Подтверждено 👍" });
    const completed = checkAndCompleteDutyWithPoints(chatId);
    sendDutyMessage(chatId);
    if (completed) {
      bot.sendMessage(chatId, `🎉 Дежурство завершено! ${getTodayPerson(chatId)?.name || "Новый герой"} получил очки!`);
    }
  }

  if (data[0] === "unconfirm") {
    const index = duty.confirmations.indexOf(userId);
    if (index !== -1) duty.confirmations.splice(index, 1);
    require("./storage").updateChat(chatId, chat);
    bot.answerCallbackQuery(query.id, { text: "Подтверждение снято 👎" });
    sendDutyMessage(chatId);
  }
});

/* Функция отправки задачи */
function sendDutyMessage(chatId) {
  const chat = getChat(chatId);
  const duty = chat.currentDuty;
  if (!duty) {
    bot.sendMessage(chatId, "⚠️ Пока нет активного дежурства");
    return;
  }

  const person = chat.members[duty.userId];
  if (!person) return;

  let text = `☀️ Сегодня дежурит: ${person.name}\n\n`;
  duty.tasks.forEach(t => {
    text += `• ${t.done ? "✅" : "⬜️"} ${t.text}\n`;
  });
  text += `\nПодтверждения семьи: ${duty.confirmations.length}`;

  const buttons = [];

  duty.tasks.forEach(t => {
    if (!t.done && duty.userId === person.id) {
      buttons.push([{ text: `✅ ${t.text}`, callback_data: `task:${t.id}` }]);
    }
    if (t.done && duty.userId === person.id) {
      buttons.push([{ text: `⬜️ ${t.text} (снять)`, callback_data: `unmark:${t.id}` }]);
    }
  });

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

/* Keep alive для Render */
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot alive"));
app.listen(PORT, () => console.log("Server running"));

console.log("🤖 Family Bot v4 — задачи создаются сразу при старте");