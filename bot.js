const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const fs = require("fs");

const TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

const DATA_FILE = "./data.json";

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const TASKS = [
  "Посуду",
  "Мусор",
  "Порядок",
  "Пыль",
  "Стирка",
  "Пылесос"
];

let familyChatId = null;

bot.on("message", (msg) => {
  if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
    familyChatId = msg.chat.id;
  }
});


// ===== регистрация семьи =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Я семейный бот дежурств 🧹\nНапишите /join каждый участник");
});

bot.onText(/\/join/, (msg) => {
  const data = loadData();
  const user = msg.from.first_name;

  if (!data.family.includes(user)) {
    data.family.push(user);
    data.queue.push(user);
    data.stats[user] = 0;
    saveData(data);
    bot.sendMessage(msg.chat.id, `${user} добавлен в семью`);
  } else {
    bot.sendMessage(msg.chat.id, "Ты уже в списке");
  }
});


// ===== утреннее сообщение =====
function sendMorning() {
  const data = loadData();
  if (!familyChatId || data.queue.length === 0) return;

  const duty = data.queue[data.currentDutyIndex];

  data.tasksToday = {};
  TASKS.forEach(t => data.tasksToday[t] = false);
  saveData(data);

  const buttons = TASKS.map(t => [{ text: "☐ " + t, callback_data: "task_" + t }]);

  buttons.push([{ text: "❌ Пропустить сегодня", callback_data: "skip" }]);

  bot.sendMessage(familyChatId,
    `🌅 Доброе утро!\nСегодня дежурит: *${duty}*`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    }
  );
}


// ===== вечерняя проверка =====
function sendEvening() {
  const data = loadData();
  if (!familyChatId || data.queue.length === 0) return;

  const duty = data.queue[data.currentDutyIndex];
  const done = Object.values(data.tasksToday).filter(v => v).length;

  let msg = `🌙 Проверка дня\nДежурный: ${duty}\nВыполнено: ${done}/${TASKS.length}\n`;

  if (done === TASKS.length) {
    msg += "🔥 Идеально! +1 балл";
    data.stats[duty] += 1;
  } else if (done === 0) {
    msg += "😡 Ничего не сделано. Штраф!";
    data.stats[duty] -= 1;
  } else {
    msg += "🙂 Частично сделано";
  }

  // следующий
  data.currentDutyIndex++;
  if (data.currentDutyIndex >= data.queue.length) {
    data.currentDutyIndex = 0;
  }

  saveData(data);

  bot.sendMessage(familyChatId, msg);
}


// ===== кнопки =====
bot.on("callback_query", (query) => {
  const data = loadData();
  const action = query.data;

  if (action.startsWith("task_")) {
    const task = action.replace("task_", "");
    data.tasksToday[task] = !data.tasksToday[task];
    saveData(data);

    bot.answerCallbackQuery(query.id, { text: `${task} отмечено` });
  }

  if (action === "skip") {
    data.currentDutyIndex++;
    if (data.currentDutyIndex >= data.queue.length) data.currentDutyIndex = 0;
    saveData(data);

    bot.sendMessage(familyChatId, "Сегодня пропуск. Следующий дежурный завтра.");
  }
});


// ===== статистика =====
bot.onText(/\/stats/, (msg) => {
  const data = loadData();
  let text = "📊 Статистика:\n";

  for (let u in data.stats) {
    text += `${u}: ${data.stats[u]} ⭐\n`;
  }

  bot.sendMessage(msg.chat.id, text);
});


// ===== расписание =====
cron.schedule("30 7 * * *", sendMorning);   // 7:30
cron.schedule("0 21 * * *", sendEvening);   // 21:00

console.log("Family bot started 🚀");
