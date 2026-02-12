require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const fs = require("fs");
const express = require("express");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const DATA_FILE = "data.json";

// создать файл если нет
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    chatId: null,
    family: [],
    dutyIndex: 0,
    stats: {},
    doneToday: false,
    fails: {},
    history: [],
    hardcore: false
  }, null, 2));
}

// загрузка
let data = JSON.parse(fs.readFileSync(DATA_FILE));

// сохранить
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// список дел
const TASKS = [
  "🍽 Помыть посуду",
  "🗑 Вынести мусор",
  "🧸 Разложить вещи",
  "🧽 Вытереть пыль",
  "🧺 Стирка (если есть)",
  "👕 Разобрать стирку",
  "🧹 Пылесос"
];

// имя
function getName(user) {
  return user.first_name || user.username;
}

// кто сегодня
function todayPerson() {
  if (data.family.length === 0) return null;
  return data.family[data.dutyIndex % data.family.length];
}

// меню кнопок
function mainMenu(chatId) {
  bot.sendMessage(chatId, "🏠 Семейное меню", {
    reply_markup: {
      keyboard: [
        ["📅 Кто сегодня", "📋 Список дел"],
        ["🏆 Рейтинг", "📊 Статистика"],
        ["⏭ Пропустить", "😈 Жесткий режим"]
      ],
      resize_keyboard: true
    }
  });
}

///// КОМАНДЫ //////

// старт
bot.onText(/\/start/, (msg) => {
  data.chatId = msg.chat.id;
  save();
  bot.sendMessage(msg.chat.id,
`🏠 Семейный бот активирован

Каждый пишет:
/join

Открыть меню:
/help`);
});

// помощь
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
`🤖 Команды:

/join — вступить
/today — кто дежурит
/tasks — список дел
/rating — рейтинг
/stats — статистика
/skip — пропуск
/hardcore — жесткий режим
/test — тест дежурного

или пользуйся кнопками 👇`);

  mainMenu(msg.chat.id);
});

// вступить
bot.onText(/\/join/, (msg) => {
  const name = getName(msg.from);

  if (!data.family.includes(name)) {
    data.family.push(name);
    data.stats[name] = 0;
    data.fails[name] = 0;
    save();
    bot.sendMessage(data.chatId, `${name} теперь в семье 😈`);
  }
});

// кто сегодня
bot.onText(/\/today/, (msg) => {
  bot.sendMessage(data.chatId, `📅 Сегодня дежурит: ${todayPerson()}`);
});

// тест
bot.onText(/\/test/, (msg) => {
  bot.sendMessage(data.chatId, `🧪 Тест. Сегодня: ${todayPerson()}`);
});

// список дел
bot.onText(/\/tasks/, (msg) => {
  let text = "📋 Сегодня нужно:\n\n";
  TASKS.forEach(t => text += "• " + t + "\n");
  bot.sendMessage(data.chatId, text);
});

// рейтинг
bot.onText(/\/rating/, (msg) => {
  let text = "🏆 Рейтинг:\n\n";
  Object.entries(data.stats)
    .sort((a,b)=>b[1]-a[1])
    .forEach(([n,s])=> text += `${n}: ${s}\n`);
  bot.sendMessage(data.chatId, text);
});

// статистика
bot.onText(/\/stats/, (msg) => {
  let text = "📊 Статистика косяков:\n\n";
  Object.entries(data.fails)
    .sort((a,b)=>b[1]-a[1])
    .forEach(([n,s])=> text += `${n}: ${s} косяков\n`);
  bot.sendMessage(data.chatId, text);
});

// пропуск
bot.onText(/\/skip/, (msg) => {
  const name = todayPerson();
  data.stats[name] -= data.hardcore ? 3 : 1;
  data.fails[name] += 1;
  data.dutyIndex++;
  save();

  bot.sendMessage(data.chatId,
`⏭ ${name} пропустил дежурство
Штраф: ${data.hardcore ? "-3" : "-1"}
Следующий дежурный: ${todayPerson()}`);
});

// жесткий режим
bot.onText(/\/hardcore/, (msg) => {
  data.hardcore = !data.hardcore;
  save();

  bot.sendMessage(data.chatId,
`😈 Жесткий режим: ${data.hardcore ? "ВКЛЮЧЕН" : "ВЫКЛЮЧЕН"}

Штрафы:
обычный −2
жесткий −5`);
});

///// КНОПКИ /////

bot.on("message", (msg) => {
  const t = msg.text;

  if (t === "📅 Кто сегодня") bot.sendMessage(data.chatId, `Сегодня: ${todayPerson()}`);
  if (t === "📋 Список дел") {
    let text="📋 Делa:\n\n";
    TASKS.forEach(a=> text+="• "+a+"\n");
    bot.sendMessage(data.chatId,text);
  }
  if (t === "🏆 Рейтинг") bot.sendMessage(data.chatId, Object.entries(data.stats).map(e=>e.join(": ")).join("\n"));
  if (t === "📊 Статистика") bot.sendMessage(data.chatId, Object.entries(data.fails).map(e=>e.join(": ")).join(" косяков\n"));
  if (t === "⏭ Пропустить") bot.emit("text",{text:"/skip",chat:msg.chat});
  if (t === "😈 Жесткий режим") bot.emit("text",{text:"/hardcore",chat:msg.chat});
});

//// УТРО 7:30
cron.schedule("30 7 * * *", () => {
  if (!data.chatId) return;

  const name = todayPerson();
  data.doneToday = false;
  save();

  let text = `☀️ Доброе утро\nСегодня дежурит: ${name}\n\n`;
  TASKS.forEach(t => text += "• "+t+"\n");

  bot.sendMessage(data.chatId, text, {
    reply_markup:{
      inline_keyboard:[
        [{text:"✅ Всё",callback_data:"done"}],
        [{text:"🤏 Частично",callback_data:"partial"}],
        [{text:"😴 Пропуск",callback_data:"skipday"}]
      ]
    }
  });

},{timezone:"Europe/Berlin"});

//// ВЕЧЕР 21
cron.schedule("0 21 * * *", () => {
  if (!data.chatId) return;

  const name = todayPerson();

  if (!data.doneToday) {
    const fine = data.hardcore ? 5 : 2;
    data.stats[name] -= fine;
    data.fails[name] += 1;

    bot.sendMessage(data.chatId,
`🚨 ${name} не отметил выполнение!
Штраф −${fine}
Завтра снова дежурит 😈`);

    save();
    return;
  }

  data.dutyIndex++;
  save();

},{timezone:"Europe/Berlin"});

//// кнопки выполнения
bot.on("callback_query",(q)=>{
  const name = todayPerson();

  if(q.data==="done"){
    data.stats[name]+=2;
    data.doneToday=true;
    bot.sendMessage(data.chatId,`🔥 ${name} герой +2`);
  }

  if(q.data==="partial"){
    data.stats[name]+=1;
    data.doneToday=true;
    bot.sendMessage(data.chatId,`${name} старался +1`);
  }

  if(q.data==="skipday"){
    data.stats[name]-=1;
    data.fails[name]+=1;
    data.doneToday=true;
    bot.sendMessage(data.chatId,`${name} ленится −1`);
    data.dutyIndex++;
  }

  save();
  bot.answerCallbackQuery(q.id);
});

//// keep alive render
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req,res)=>res.send("bot alive"));
app.listen(PORT,()=>console.log("Server running",PORT));

console.log("🤖 Family bot 2.0 started");
