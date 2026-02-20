require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");

const { addMember } = require("./members");
const { getTodayPerson, createDuty, nextDuty } = require("./duty");
const { getChat } = require("./storage");
const config = require("./config");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

/*
  /start
*/
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`🏠 Семейный бот активирован

Каждый участник должен написать:
/join`);
});

/*
  /join
*/
bot.onText(/\/join/, (msg) => {
  const added = addMember(msg.chat.id, msg.from);

  if (added) {
    bot.sendMessage(msg.chat.id, `${msg.from.first_name} добавлен в семью 👌`);
  } else {
    bot.sendMessage(msg.chat.id, `Ты уже в семье 😈`);
  }
});

/*
  /today
*/
bot.onText(/\/today/, (msg) => {
  const person = getTodayPerson(msg.chat.id);
  if (!person) {
    bot.sendMessage(msg.chat.id, "Нет участников");
    return;
  }

  bot.sendMessage(msg.chat.id, `Сегодня дежурит: ${person.name}`);
});

/*
  Утренний cron
*/
cron.schedule("30 7 * * *", () => {
  const data = require("./storage").load();

  for (let chatId in data.chats) {
    const duty = createDuty(chatId);
    if (!duty) continue;

    let text = `☀️ Доброе утро\nСегодня дежурит: ${getTodayPerson(chatId).name}\n\n`;

    duty.tasks.forEach(t => {
      text += "• " + t.text + "\n";
    });

    bot.sendMessage(chatId, text);
  }

}, { timezone: config.timezone });

/*
  Вечерний cron
*/
cron.schedule("0 21 * * *", () => {
  const data = require("./storage").load();

  for (let chatId in data.chats) {
    nextDuty(chatId);
    bot.sendMessage(chatId, "🔁 День завершен. Завтра новый герой 😈");
  }

}, { timezone: config.timezone });

/*
  Keep alive для Render
*/
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot alive"));
app.listen(PORT, () => console.log("Server running"));

console.log("🤖 Family Bot v1 started");