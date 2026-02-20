require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");

const { addMember } = require("./members");
const { getTodayPerson, createDuty, nextDuty, markTaskDone, confirmDuty, checkAndCompleteDuty } = require("./duty");
const { getChat } = require("./storage");
const config = require("./config");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

/* /start */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`🏠 Семейный бот активирован

Каждый участник должен написать:
/join`);
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

/* Отметка задач и подтверждения — inline кнопки */
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data.split(":"); // task:1 или confirm

  if (data[0] === "task") {
    const taskId = parseInt(data[1]);
    const res = markTaskDone(chatId, taskId, userId);
    if (res.error) {
      bot.answerCallbackQuery(query.id, { text: res.error, show_alert: true });
    } else {
      bot.answerCallbackQuery(query.id, { text: "Задача отмечена ✅" });
      // Обновляем сообщение с задачами
      sendDutyMessage(chatId);
    }
  }

  if (data[0] === "confirm") {
    const res = confirmDuty(chatId, userId);
    if (res.error) {
      bot.answerCallbackQuery(query.id, { text: res.error, show_alert: true });
    } else {
      bot.answerCallbackQuery(query.id, { text: "Подтверждено 👍" });
      checkAndCompleteDuty(chatId);
      sendDutyMessage(chatId); // обновляем статус задач
    }
  }
});

/* Отправка сообщения с задачами дежурного */
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

  duty.tasks.forEach(t => {
    if (!t.done && duty.userId === person.id) {
      buttons.push([{ text: `✅ ${t.text}`, callback_data: `task:${t.id}` }]);
    }
  });

  // Кнопка подтверждения для других участников
  buttons.push([{ text: "👍 Подтверждаю", callback_data: "confirm" }]);

  bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: buttons
    }
  });
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

/* Автоматическое завершение дежурства после 12:00 */
cron.schedule("0 12 * * *", () => {
  const data = require("./storage").load();

  for (let chatId in data.chats) {
    checkAndCompleteDuty(chatId);
  }
}, { timezone: config.timezone });

/* Keep alive для Render */
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot alive"));
app.listen(PORT, () => console.log("Server running"));

console.log("🤖 Family Bot v2 started with tasks ✅ and confirmations 👍");