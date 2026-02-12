require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const fs = require("fs");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });


const DATA_FILE = "data.json";

if (!fs.existsSync(DATA_FILE)) {
    console.log("Создаю новый data.json");
  
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      chatId: null,
      family: [],
      dutyIndex: 0,
      stats: {},
      doneToday: false
    }, null, 2));
  }

// дела
const TASKS = [
  "🍽 Помыть посуду",
  "🗑 Вынести мусор",
  "🧸 Разложить вещи",
  "🧽 Вытереть пыль",
  "🧺 Стирка (если есть)",
  "👕 Разобрать стирку",
  "🧹 Пылесос"
];

let data = {
  chatId: null,
  family: [],
  dutyIndex: 0,
  stats: {},
  doneToday: false
};

// загрузка
if (fs.existsSync(DATA_FILE)) {
  data = JSON.parse(fs.readFileSync(DATA_FILE));
}

// сохранение
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// получить имя
function getName(user) {
  return user.first_name || user.username;
}

// регистрация чата
bot.onText(/\/start/, (msg) => {
  data.chatId = msg.chat.id;
  save();
  bot.sendMessage(msg.chat.id, "🏠 Семейный бот активирован.\nВсе пишите /join");
});

// вступить в семью
bot.onText(/\/join/, (msg) => {
  const name = getName(msg.from);

  if (!data.family.includes(name)) {
    data.family.push(name);
    data.stats[name] = 0;
    save();
    bot.sendMessage(data.chatId, `${name} добавлен в семью 😈`);
  }
});

// рейтинг
bot.onText(/\/rating/, (msg) => {
  let text = "🏆 Рейтинг семьи:\n\n";

  Object.entries(data.stats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, score]) => {
      text += `${name}: ${score} баллов\n`;
    });

  bot.sendMessage(data.chatId, text);
});

// кто сегодня
function todayPerson() {
  if (data.family.length === 0) return null;
  return data.family[data.dutyIndex % data.family.length];
}

// утро 7:30
cron.schedule("30 7 * * *", () => {
  if (!data.chatId) return;
  if (data.family.length === 0) return;

  const name = todayPerson();
  data.doneToday = false;
  save();

  let text = `☀️ Доброе утро\n\nСегодня дежурит: ${name}\n\nСписок дел:\n`;
  TASKS.forEach(t => text += "• " + t + "\n");

  bot.sendMessage(data.chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Всё сделано", callback_data: "done" }],
        [{ text: "🤏 Частично", callback_data: "partial" }],
        [{ text: "😴 Пропустить", callback_data: "skip" }]
      ]
    }
  });
}, {
  timezone: "Europe/Berlin"
});

// вечер 21:00 проверка
cron.schedule("0 21 * * *", () => {
  if (!data.chatId) return;

  if (!data.doneToday) {
    const name = todayPerson();
    data.stats[name] -= 2;

    bot.sendMessage(data.chatId,
      `🚨 ${name} ничего не отметил!\nШТРАФ −2\nЗавтра снова дежурит 😈`);

    save();
    return;
  }

  // если сделал — следующий
  data.dutyIndex++;
  save();
}, {
  timezone: "Europe/Berlin"
});

// кнопки
bot.on("callback_query", (q) => {
  const action = q.data;
  const name = todayPerson();

  if (action === "done") {
    data.stats[name] += 2;
    data.doneToday = true;

    bot.sendMessage(data.chatId,
      `🔥 ${name} всё сделал!\n+2 балла\nГерой семьи`);

  }

  if (action === "partial") {
    data.stats[name] += 1;
    data.doneToday = true;

    bot.sendMessage(data.chatId,
      `👍 ${name} сделал частично\n+1 балл`);
  }

  if (action === "skip") {
    data.stats[name] -= 1;
    data.doneToday = true;

    bot.sendMessage(data.chatId,
      `😴 ${name} пропустил\n−1 балл\nНо завтра следующий`);
  }

  save();
  bot.answerCallbackQuery(q.id);
});

console.log("🤖 Family bot started");
