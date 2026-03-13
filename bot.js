require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");
const storage = require("./storageBot");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID_ENV = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;

let data;
let waitingForTaskFrom = null;

const DEFAULT_TASKS = [
  "🍽 Помыть посуду",
  "🗑 Собрать мусор",
  "🧸 Разложить вещи",
  "🧽 Вытереть пыль",
  "🧺 Стирка (если есть)",
  "👕 Разобрать стирку",
  "🧹 Пылесос",
];

function getName(user) {
  return user.first_name || user.username || "User";
}

function todayPerson() {
  if (!data.family.length) return null;
  return data.family[data.dutyIndex % data.family.length];
}

function getTasks() {
  if (data.tasks && data.tasks.length > 0) return data.tasks;
  return DEFAULT_TASKS;
}

function isAdmin(userId) {
  if (ADMIN_ID_ENV) return userId === ADMIN_ID_ENV;
  return data.adminId != null && userId === data.adminId;
}

function save() {
  storage.save(data).catch((err) => console.error("Save error", err));
}

function mainMenu(chatId, userId) {
  const rows = [
    ["📅 Кто сегодня", "📋 Список дел"],
    ["🏆 Рейтинг", "📊 Статистика"],
    ["⏭ Пропустить"],
  ];
  if (userId != null && isAdmin(userId)) rows.push(["⚙️ Админ"]);
  bot.sendMessage(chatId, "🏠 Семейное меню", {
    reply_markup: { keyboard: rows, resize_keyboard: true },
  });
}

// Утренний мем 6+ (wholesomememes — без пошлостей и матов)
async function sendMorningMeme(chatId) {
  const fallbackMsg = () =>
    bot.sendMessage(chatId, "☀️ Доброе утро! Мем не подгрузился, но день будет отличным 😄").catch(() => {});

  // Пробуем meme-api.com (wholesomememes)
  try {
    const res = await fetch("https://meme-api.com/gimme/wholesomememes", { redirect: "follow" });
    if (!res.ok) throw new Error(res.statusText);
    const json = await res.json();
    const url = json?.url;
    if (url && /\.(jpg|jpeg|png|gif|webp)/i.test(url)) {
      await bot.sendPhoto(chatId, url, { caption: "☀️ Доброе утро! Мем на старт дня 😄" });
      return;
    }
  } catch (e) {
    console.error("Meme API error", e.message);
  }

  // Запас: Reddit r/wholesomememes
  try {
    const res = await fetch("https://www.reddit.com/r/wholesomememes/random.json", {
      headers: { "User-Agent": "FamilyBot/1.0 (Telegram)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(res.statusText);
    const json = await res.json();
    const list = json?.data?.children || json?.[0]?.data?.children;
    if (!list?.length) throw new Error("No posts");
    const post = list[0].data;
    let url = post.url;
    if (post.is_gallery && post.media_metadata) {
      const first = Object.keys(post.media_metadata)[0];
      const meta = post.media_metadata[first];
      if (meta?.s?.u) url = meta.s.u.replace(/&amp;/g, "&");
    }
    const isImage = url && /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
    if (isImage) {
      await bot.sendPhoto(chatId, url, { caption: "☀️ Доброе утро! Мем на старт дня 😄" });
      return;
    }
    if (post.preview?.images?.[0]?.source?.url) {
      const img = post.preview.images[0].source.url.replace(/&amp;/g, "&");
      await bot.sendPhoto(chatId, img, { caption: "☀️ Доброе утро! Мем на старт дня 😄" });
      return;
    }
  } catch (err) {
    console.error("Reddit meme error", err.message);
  }

  fallbackMsg();
}

async function run() {
  data = await storage.load();
  data = { ...storage.DEFAULT_DATA, ...data };
  if (!data.memberIds) data.memberIds = {};
  if (data.dutyStatus === undefined) data.dutyStatus = "none";
  if (data.daySkipped === undefined) data.daySkipped = false;
  if (data.adminId === undefined) data.adminId = null;
  if (data.tasks === undefined) data.tasks = null;
  save();

  // ---- Команды ----
  bot.onText(/\/start/, (msg) => {
    data.chatId = msg.chat.id;
    save();
    bot.sendMessage(
      msg.chat.id,
      `🏠 Семейный бот активирован

Каждый пишет:
/join

Открыть меню:
/help`
    );
    mainMenu(msg.chat.id, msg.from?.id);
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `🤖 Команды:

/join — вступить
/today — кто дежурит
/tasks — список дел
/rating — рейтинг
/stats — статистика
/skip — пропуск
/hardcore — жесткий режим
/setadmin — стать админом (первый в чате)
/admin — панель админа (задания, режим)
/test — тест дежурного

или пользуйся кнопками 👇`
    );
    mainMenu(msg.chat.id, msg.from?.id);
  });

  bot.onText(/\/join/, (msg) => {
    const name = getName(msg.from);
    if (!data.family.includes(name)) {
      data.family.push(name);
      data.stats[name] = (data.stats[name] ?? 0);
      data.fails[name] = (data.fails[name] ?? 0);
      data.memberIds[name] = msg.from.id;
      save();
      bot.sendMessage(data.chatId, `${name} теперь в семье 😈`);
    }
  });

  bot.onText(/\/today/, (msg) => {
    bot.sendMessage(data.chatId, `📅 Сегодня дежурит: ${todayPerson()}`);
  });

  bot.onText(/\/test/, (msg) => {
    bot.sendMessage(data.chatId, `🧪 Тест. Сегодня: ${todayPerson()}`);
  });

  bot.onText(/\/tasks/, (msg) => {
    let text = "📋 Сегодня нужно:\n\n";
    getTasks().forEach((t) => (text += "• " + t + "\n"));
    bot.sendMessage(data.chatId, text);
  });

  bot.onText(/\/rating/, (msg) => {
    let text = "🏆 Рейтинг:\n\n";
    Object.entries(data.stats)
      .sort((a, b) => b[1] - a[1])
      .forEach(([n, s]) => (text += `${n}: ${s}\n`));
    bot.sendMessage(data.chatId, text);
  });

  bot.onText(/\/stats/, (msg) => {
    let text = "📊 Статистика косяков:\n\n";
    Object.entries(data.fails)
      .sort((a, b) => b[1] - a[1])
      .forEach(([n, s]) => (text += `${n}: ${s} косяков\n`));
    bot.sendMessage(data.chatId, text);
  });

  bot.onText(/\/skip/, (msg) => {
    const name = todayPerson();
    data.stats[name] -= data.hardcore ? 3 : 1;
    data.fails[name] = (data.fails[name] || 0) + 1;
    data.dutyIndex++;
    save();
    bot.sendMessage(
      data.chatId,
      `⏭ ${name} пропустил дежурство\nШтраф: ${data.hardcore ? "-3" : "-1"}\nСледующий дежурный: ${todayPerson()}`
    );
  });

  bot.onText(/\/hardcore/, (msg) => {
    data.hardcore = !data.hardcore;
    save();
    bot.sendMessage(
      data.chatId,
      `😈 Жесткий режим: ${data.hardcore ? "ВКЛЮЧЕН" : "ВЫКЛЮЧЕН"}\n\nШтрафы:\nобычный −2\nжесткий −5`
    );
  });

  bot.onText(/\/setadmin/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const name = getName(msg.from);
    if (!data.family.includes(name)) {
      bot.sendMessage(chatId, "Сначала напишите /join.");
      return;
    }
    if (data.adminId != null && !isAdmin(userId)) {
      bot.sendMessage(chatId, "Админ уже назначен. Только он может передать права.");
      return;
    }
    data.adminId = userId;
    save();
    bot.sendMessage(chatId, "✅ Вы назначены админом. Подтверждать/отклонять дежурства и редактировать задания — через /admin или кнопку «⚙️ Админ».");
    mainMenu(chatId, userId);
  });

  bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, "Только админ может открыть панель.");
      return;
    }
    sendAdminPanel(chatId);
  });

  function sendAdminPanel(chatId) {
    const tasks = getTasks();
    bot.sendMessage(chatId, `⚙️ Админ\n\nЖесткий режим: ${data.hardcore ? "ВКЛ" : "ВЫКЛ"}\nЗаданий: ${tasks.length}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: data.hardcore ? "😈 Выкл жесткий режим" : "😈 Вкл жесткий режим", callback_data: "admin:hardcore" }],
          [{ text: "➕ Добавить задание", callback_data: "admin:add_task" }],
          [{ text: "📋 Список заданий (удалить)", callback_data: "admin:list_tasks" }],
          [{ text: "⏭ След. дежурный (без штрафа)", callback_data: "admin:next_duty" }],
        ],
      },
    });
  }

  // ---- Кнопки меню ----
  bot.on("message", (msg) => {
    const t = msg.text;
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (waitingForTaskFrom === userId && isAdmin(userId) && t && !t.startsWith("/")) {
      if (!data.tasks) data.tasks = [...getTasks()];
      data.tasks.push(t.trim());
      save();
      waitingForTaskFrom = null;
      bot.sendMessage(chatId, `✅ Задание добавлено: «${t.trim()}»`);
      return;
    }
    waitingForTaskFrom = null;

    if (t === "📅 Кто сегодня") bot.sendMessage(chatId, `Сегодня: ${todayPerson()}`);
    if (t === "📋 Список дел") {
      let text = "📋 Дела:\n\n";
      getTasks().forEach((a) => (text += "• " + a + "\n"));
      bot.sendMessage(chatId, text);
    }
    if (t === "🏆 Рейтинг")
      bot.sendMessage(chatId, Object.entries(data.stats).map((e) => e.join(": ")).join("\n"));
    if (t === "📊 Статистика")
      bot.sendMessage(chatId, Object.entries(data.fails).map((e) => e.join(": ") + " косяков").join("\n"));
    if (t === "⏭ Пропустить") bot.emit("text", { text: "/skip", chat: msg.chat, from: msg.from });
    if (t === "😈 Жесткий режим") bot.emit("text", { text: "/hardcore", chat: msg.chat, from: msg.from });
    if (t === "⚙️ Админ") bot.emit("text", { text: "/admin", chat: msg.chat, from: msg.from });
  });

  // ---- Утро 6:00 — мем ----
  cron.schedule(
    "0 9 * * *",
    async () => {
      if (data.chatId) await sendMorningMeme(data.chatId);
    },
    { timezone: "Europe/Minsk" }
  );

  // ---- Утро 7:30 — дежурство ----
  cron.schedule(
    "30 7 * * *",
    () => {
      if (!data.chatId) return;
      const name = todayPerson();
      data.doneToday = false;
      data.dutyStatus = "none";
      data.daySkipped = false;
      save();

      let text = `☀️ Доброе утро\nСегодня дежурит: ${name}\n\n`;
      getTasks().forEach((t) => (text += "• " + t + "\n"));

      bot.sendMessage(data.chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Всё", callback_data: "done" }],
            [{ text: "🤏 Частично", callback_data: "partial" }],
            [{ text: "😴 Пропуск", callback_data: "skipday" }],
          ],
        },
      });
    },
    { timezone: "Europe/Berlin" }
  );

  // ---- Вечер 21:00 ----
  cron.schedule(
    "0 21 * * *",
    () => {
      if (!data.chatId) return;
      const name = todayPerson();

      if (data.daySkipped) {
        save();
        return;
      }

      if (!data.doneToday || data.dutyStatus !== "confirmed") {
        const fine = data.hardcore ? 5 : 2;
        data.stats[name] = (data.stats[name] || 0) - fine;
        data.fails[name] = (data.fails[name] || 0) + 1;
        bot.sendMessage(
          data.chatId,
          `🚨 ${name} не отметил выполнение (или не подтверждено админом)!\nШтраф −${fine}\nЗавтра снова дежурит 😈`
        );
        save();
        return;
      }

      data.dutyIndex++;
      save();
    },
    { timezone: "Europe/Berlin" }
  );

  // ---- Inline: выполнение ----
  bot.on("callback_query", (q) => {
    const fromId = q.from.id;
    const chatId = data.chatId || q.message?.chat?.id;

    if (q.data === "admin:hardcore") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      data.hardcore = !data.hardcore;
      save();
      bot.sendMessage(chatId, `😈 Жесткий режим: ${data.hardcore ? "ВКЛ" : "ВЫКЛ"}`);
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data === "admin:add_task") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      waitingForTaskFrom = fromId;
      bot.sendMessage(chatId, "Напишите текст нового задания (одним сообщением):");
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data === "admin:list_tasks") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      const tasks = getTasks();
      const buttons = tasks.map((_, i) => ({ text: `🗑 ${i + 1}`, callback_data: `task_del:${i}` }));
      const rows = [];
      for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
      if (rows.length === 0) {
        bot.sendMessage(chatId, "Нет заданий. Добавьте через Админ → Добавить задание.");
      } else {
        bot.sendMessage(chatId, "Удалить задание (нажмите номер):\n\n" + tasks.map((t, i) => `${i + 1}. ${t}`).join("\n"), {
          reply_markup: { inline_keyboard: rows },
        });
      }
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data === "admin:next_duty") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      data.dutyIndex++;
      save();
      bot.sendMessage(chatId, `⏭ Дежурный сменён. Теперь: ${todayPerson()}`);
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data && q.data.startsWith("task_del:")) {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      const idx = parseInt(q.data.replace("task_del:", ""), 10);
      if (!data.tasks) data.tasks = [...getTasks()];
      if (idx >= 0 && idx < data.tasks.length) {
        const removed = data.tasks.splice(idx, 1)[0];
        if (data.tasks.length === 0) data.tasks = null;
        save();
        bot.sendMessage(chatId, `🗑 Удалено: «${removed}»`);
      }
      bot.answerCallbackQuery(q.id);
      return;
    }

    const name = todayPerson();
    if (!name) {
      bot.answerCallbackQuery(q.id, { text: "Сначала добавьте участников: /join" });
      return;
    }
    const dutyUserId = data.memberIds[name] ?? null;

    if (q.data === "done") {
      data.dutyStatus = "pending";
      save();
      bot.sendMessage(data.chatId, `⏳ ${name} нажал «Всё». Ждём подтверждения админа.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Подтвердить", callback_data: "duty_confirm" }],
            [{ text: "❌ Отклонить", callback_data: "duty_reject" }],
          ],
        },
      });
    }

    if (q.data === "duty_confirm") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Подтверждать может только админ." });
        return;
      }
      if (data.dutyStatus !== "pending") {
        bot.answerCallbackQuery(q.id, { text: "Уже обработано" });
        return;
      }
      data.dutyStatus = "confirmed";
      data.doneToday = true;
      data.stats[name] = (data.stats[name] || 0) + 2;
      save();
      bot.sendMessage(data.chatId, `🔥 ${name} герой +2. Подтверждено!`);
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data === "duty_reject") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Отклонять может только админ." });
        return;
      }
      if (data.dutyStatus !== "pending") {
        bot.answerCallbackQuery(q.id, { text: "Уже обработано" });
        return;
      }
      data.dutyStatus = "rejected";
      save();
      bot.sendMessage(data.chatId, `❌ Подтверждение отклонено. ${name}, нажми «Всё» снова, когда выполнишь задания.`);
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data === "partial") {
      data.dutyStatus = "none";
      data.doneToday = false;
      save();
      bot.sendMessage(data.chatId, `🤏 ${name} частично. Вечером −2 и завтра снова дежурный.`);
    }

    if (q.data === "skipday") {
      data.stats[name] = (data.stats[name] || 0) - 1;
      data.fails[name] = (data.fails[name] || 0) + 1;
      data.dutyIndex++;
      data.daySkipped = true;
      save();
      bot.sendMessage(data.chatId, `${name} ленится −1. Следующий дежурный: ${todayPerson()}`);
    }

    bot.answerCallbackQuery(q.id);
  });

  // ---- Keep-alive для Render ----
  const app = express();
  const PORT = process.env.PORT || 3000;
  app.get("/", (req, res) => res.send("bot alive"));
  app.listen(PORT, () => console.log("Server running", PORT));

  console.log("🤖 Family bot 2.0 started");
  if (process.env.GITHUB_GIST_TOKEN && process.env.GITHUB_GIST_ID) console.log("📦 Data: GitHub Gist");
  else if (process.env.MONGODB_URI) console.log("📦 Data: MongoDB");
  else console.log("📦 Data: data.json (local)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
