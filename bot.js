require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");
const storage = require("./storageBot");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID_ENV = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;
const TZ = "Europe/Minsk";

let data;
let waitingForTaskFrom = null;
let waitingForTaskEdit = null;

const DEFAULT_TASKS = [
  { text: "🍽 Помыть посуду", period: "daily" },
  { text: "🗑 Собрать мусор", period: "daily" },
  { text: "🧸 Разложить вещи", period: "daily" },
  { text: "🧽 Вытереть пыль", period: "daily" },
  { text: "🧺 Стирка (если есть)", period: "weekly", weekday: 0 },
  { text: "👕 Разобрать стирку", period: "weekly", weekday: 0 },
  { text: "🧹 Пылесос", period: "weekly", weekday: 6 },
];

function getName(user) {
  return user.first_name || user.username || "User";
}

function todayPerson() {
  if (!data.family.length) return null;
  return data.family[data.dutyIndex % data.family.length];
}

function nextPerson() {
  if (!data.family.length) return null;
  return data.family[(data.dutyIndex + 1) % data.family.length];
}

function getTasksRaw() {
  if (data.tasks && data.tasks.length > 0) return data.tasks;
  return DEFAULT_TASKS;
}

function normalizeTask(t) {
  if (typeof t === "string") return { text: t, period: "daily" };
  return { text: t.text || t.title || "", period: t.period || "daily", weekday: t.weekday ?? 0 };
}

function getTasksForDate(date) {
  const raw = getTasksRaw();
  const day = date.getDay();
  return raw
    .map(normalizeTask)
    .filter((t) => {
      if (t.period === "daily") return true;
      if (t.period === "weekly") return t.weekday === day;
      return true;
    })
    .map((t) => t.text)
    .filter(Boolean);
}

function isAdmin(userId) {
  if (ADMIN_ID_ENV) return userId === ADMIN_ID_ENV;
  return data.adminId != null && userId === data.adminId;
}

function isDuty(userId) {
  const name = todayPerson();
  if (!name) return false;
  return (data.memberIds[name] ?? null) === userId;
}

function isMember(userId) {
  return userId != null && Object.values(data.memberIds || {}).includes(userId);
}

function save() {
  storage.save(data).catch((err) => console.error("Save error", err));
}

function mainMenu(chatId, userId) {
  let rows;
  if (userId != null && !isMember(userId)) {
    rows = [["👋 Вступить в семью"], ["ℹ️ Помощь"]];
  } else {
    rows = [
      ["📅 Кто сегодня", "📋 Задачи на сегодня"],
      ["🏆 Рейтинг", "📊 Статистика"],
      ["ℹ️ Помощь"],
    ];
    if (userId != null && isAdmin(userId)) rows.push(["⚙️ Админ"]);
  }
  bot.sendMessage(chatId, "🏠 Семейный бот", {
    reply_markup: { keyboard: rows, resize_keyboard: true },
  });
}

function sendTasksWithButton(chatId) {
  const name = todayPerson();
  const tasks = getTasksForDate(new Date());
  let text = `📋 Сегодня дежурит: **${name || "—"}**\n\n`;
  text += tasks.length ? tasks.map((t) => "• " + t).join("\n") : "Нет заданий на сегодня.";
  const opts = { parse_mode: "Markdown" };
  if (name && tasks.length) {
    opts.reply_markup = {
      inline_keyboard: [[{ text: "✅ Выполнено", callback_data: "duty_done" }]],
    };
  }
  return bot.sendMessage(chatId, text, opts);
}

function sendCongratsAndTomorrow(chatId, completedName) {
  const tomorrowPerson = todayPerson();
  bot.sendMessage(
    chatId,
    `🎉 Молодец, ${completedName}! +2 балла в рейтинг.\n\nЗавтра дежурит: **${tomorrowPerson}**`,
    { parse_mode: "Markdown" }
  );
}

async function sendMorningMeme(chatId) {
  const fallback = () =>
    bot.sendMessage(chatId, "☀️ Доброе утро! Хорошего дня 😄").catch(() => {});
  try {
    const res = await fetch("https://meme-api.com/gimme/wholesomememes", { redirect: "follow" });
    if (!res.ok) throw new Error(res.statusText);
    const json = await res.json();
    const url = json?.url;
    if (url && /\.(jpg|jpeg|png|gif|webp)/i.test(url)) {
      await bot.sendPhoto(chatId, url, { caption: "☀️ Мем на старт дня 😄" });
      return;
    }
  } catch (e) {
    console.error("Meme API error", e.message);
  }
  fallback();
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

  // ---- Помощь ----
  function sendHelp(chatId) {
    const text = `ℹ️ **Что умеет бот**

• Назначает дежурного по очереди каждый день
• Показывает список заданий с кнопкой «Выполнено»
• Кнопку «Выполнено» нажимает только дежурный
• Админ подтверждает или отклоняет выполнение
• При подтверждении: +2 балла, завтра следующий дежурный
• Если не отметить вовремя — штраф −2 и снова дежурный завтра
• В 9:00 — напоминание и мем; в 20:00 — напоминание; в 22:00 — авто-подтверждение или штраф
• Админ может: добавить/удалить/редактировать задания, заменить дежурного`;
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  // ---- Старт ----
  bot.onText(/\/start/, (msg) => {
    data.chatId = msg.chat.id;
    save();
    bot.sendMessage(msg.chat.id, "🏠 Семейный бот. Нажмите кнопку **ℹ️ Помощь**, чтобы узнать возможности.", {
      parse_mode: "Markdown",
    });
    mainMenu(msg.chat.id, msg.from?.id);
  });

  bot.onText(/\/help/, (msg) => {
    sendHelp(msg.chat.id);
    mainMenu(msg.chat.id, msg.from?.id);
  });

  // ---- Участники и админ ----
  bot.onText(/\/join/, (msg) => {
    const name = getName(msg.from);
    if (!data.family.includes(name)) {
      data.family.push(name);
      data.stats[name] = (data.stats[name] ?? 0);
      data.fails[name] = (data.fails[name] ?? 0);
      data.memberIds[name] = msg.from.id;
      save();
      bot.sendMessage(data.chatId, `${name} в семье ✅`);
    }
    mainMenu(data.chatId, msg.from?.id);
  });

  bot.onText(/\/setadmin/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const name = getName(msg.from);
    if (!data.family.includes(name)) {
      bot.sendMessage(chatId, "Сначала нажмите кнопку с задачами и добавьте себя в семью (или напишите в чат, что вы участвуете).");
      return;
    }
    if (data.adminId != null && !isAdmin(userId)) {
      bot.sendMessage(chatId, "Админ уже назначен. Только он может передать права.");
      return;
    }
    data.adminId = userId;
    save();
    bot.sendMessage(chatId, "✅ Вы назначены админом. Откройте панель кнопкой **⚙️ Админ**.", { parse_mode: "Markdown" });
    mainMenu(chatId, userId);
  });

  function sendAdminPanel(chatId) {
    const raw = getTasksRaw();
    bot.sendMessage(chatId, `⚙️ **Админ**\n\nЗаданий: ${raw.length}`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: data.hardcore ? "😈 Выкл жёсткий режим" : "😈 Вкл жёсткий режим", callback_data: "admin:hardcore" }],
          [{ text: "➕ Добавить задание", callback_data: "admin:add_task" }],
          [{ text: "📋 Задания (удалить/редактировать)", callback_data: "admin:list_tasks" }],
          [{ text: "⏭ Заменить дежурного", callback_data: "admin:next_duty" }],
        ],
      },
    });
  }

  bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, "Только админ может открыть панель.");
      return;
    }
    sendAdminPanel(chatId);
  });

  // ---- Кнопки меню (главное: Админ вызывается напрямую, не через emit) ----
  bot.on("message", (msg) => {
    const t = msg.text;
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!t || typeof t !== "string") return;
    if (t.startsWith("/")) return;

    // Ожидание текста нового задания от админа
    if (waitingForTaskFrom === userId && isAdmin(userId)) {
      if (!data.tasks) data.tasks = getTasksRaw().map(normalizeTask);
      else data.tasks = data.tasks.map(normalizeTask);
      data.tasks.push({ text: t.trim(), period: "daily" });
      save();
      waitingForTaskFrom = null;
      bot.sendMessage(chatId, `✅ Добавлено: «${t.trim()}»`);
      return;
    }
    // Ожидание текста при редактировании задания
    if (waitingForTaskEdit && waitingForTaskEdit.userId === userId && isAdmin(userId)) {
      const idx = waitingForTaskEdit.index;
      if (!data.tasks) data.tasks = getTasksRaw().map(normalizeTask);
      else data.tasks = data.tasks.map(normalizeTask);
      if (idx >= 0 && idx < data.tasks.length) {
        const prev = normalizeTask(data.tasks[idx]);
        data.tasks[idx] = { ...prev, text: t.trim() };
        save();
        bot.sendMessage(chatId, `✅ Задание изменено.`);
      }
      waitingForTaskEdit = null;
      return;
    }
    waitingForTaskFrom = null;
    waitingForTaskEdit = null;

    if (t === "📅 Кто сегодня") {
      bot.sendMessage(chatId, `Сегодня дежурит: **${todayPerson() || "—"}**`, { parse_mode: "Markdown" });
      return;
    }
    if (t === "📋 Задачи на сегодня") {
      sendTasksWithButton(chatId);
      return;
    }
    if (t === "🏆 Рейтинг") {
      const lines = Object.entries(data.stats)
        .sort((a, b) => b[1] - a[1])
        .map(([n, s]) => `${n}: ${s}`);
      bot.sendMessage(chatId, "🏆 Рейтинг:\n\n" + (lines.length ? lines.join("\n") : "Пока пусто"));
      return;
    }
    if (t === "📊 Статистика") {
      const lines = Object.entries(data.fails)
        .sort((a, b) => b[1] - a[1])
        .map(([n, s]) => `${n}: ${s} косяков`);
      bot.sendMessage(chatId, "📊 Статистика:\n\n" + (lines.length ? lines.join("\n") : "Пока пусто"));
      return;
    }
    if (t === "ℹ️ Помощь") {
      sendHelp(chatId);
      mainMenu(chatId, userId);
      return;
    }
    if (t === "👋 Вступить в семью") {
      const name = getName(msg.from);
      if (!data.family.includes(name)) {
        data.family.push(name);
        data.stats[name] = (data.stats[name] ?? 0);
        data.fails[name] = (data.fails[name] ?? 0);
        data.memberIds[name] = msg.from.id;
        save();
        bot.sendMessage(chatId, `${name} в семье ✅`);
      } else {
        bot.sendMessage(chatId, "Вы уже в семье ✅");
      }
      mainMenu(chatId, userId);
      return;
    }
    if (t === "⚙️ Админ") {
      if (!isAdmin(userId)) {
        bot.sendMessage(chatId, "Только админ может открыть панель.");
        return;
      }
      sendAdminPanel(chatId);
      return;
    }
  });

  // ---- Cron 9:00 Минск: напоминание + список с кнопкой + мем ----
  cron.schedule(
    "0 9 * * *",
    () => {
      if (!data.chatId) return;
      data.doneToday = false;
      data.dutyStatus = "none";
      data.daySkipped = false;
      save();

      sendTasksWithButton(data.chatId).then(() => sendMorningMeme(data.chatId));
    },
    { timezone: TZ }
  );

  // ---- Cron 20:00 Минск: напоминание ----
  cron.schedule(
    "0 20 * * *",
    () => {
      if (!data.chatId) return;
      if (data.doneToday && data.dutyStatus === "confirmed") return;
      const name = todayPerson();
      bot.sendMessage(
        data.chatId,
        `⏰ Дежурный ${name}: осталось 2 часа. Отметьте выполнение кнопкой «Выполнено», иначе в 22:00 — штраф −2 и завтра снова дежурный.`
      );
    },
    { timezone: TZ }
  );

  // ---- Cron 22:00 Минск: авто-подтверждение или штраф ----
  cron.schedule(
    "0 22 * * *",
    () => {
      if (!data.chatId) return;
      const name = todayPerson();

      if (data.dutyStatus === "pending") {
        data.dutyStatus = "confirmed";
        data.doneToday = true;
        data.stats[name] = (data.stats[name] || 0) + 2;
        data.dutyIndex++;
        save();
        bot.sendMessage(data.chatId, `⏰ Админ не ответил. Выполнение засчитано автоматически.`);
        sendCongratsAndTomorrow(data.chatId, name);
        return;
      }

      if (data.doneToday && data.dutyStatus === "confirmed") return;

      data.stats[name] = (data.stats[name] || 0) - 2;
      data.fails[name] = (data.fails[name] || 0) + 1;
      save();
      bot.sendMessage(
        data.chatId,
        `🚨 ${name} не отметил выполнение (или не нажал снова после отклонения). Штраф −2. Завтра снова дежурный.`
      );
    },
    { timezone: TZ }
  );

  // ---- Inline callbacks ----
  bot.on("callback_query", (q) => {
    const fromId = q.from.id;
    const chatId = data.chatId || q.message?.chat?.id;

    // ----- Кнопка "Выполнено" (только дежурный) -----
    if (q.data === "duty_done") {
      const name = todayPerson();
      if (!name) {
        bot.answerCallbackQuery(q.id, { text: "Сначала добавьте участников в семью." });
        return;
      }
      if (!isDuty(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только дежурный может отметить выполнение." });
        return;
      }
      data.dutyStatus = "pending";
      save();
      bot.sendMessage(chatId, `⏳ ${name} отметил выполнение. Ждём подтверждения админа.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Подтвердить", callback_data: "duty_confirm" }],
            [{ text: "❌ Отклонить", callback_data: "duty_reject" }],
          ],
        },
      });
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data === "duty_confirm") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Подтверждать может только админ." });
        return;
      }
      if (data.dutyStatus !== "pending") {
        bot.answerCallbackQuery(q.id, { text: "Уже обработано." });
        return;
      }
      const name = todayPerson();
      data.dutyStatus = "confirmed";
      data.doneToday = true;
      data.stats[name] = (data.stats[name] || 0) + 2;
      data.dutyIndex++;
      save();
      bot.sendMessage(chatId, "✅ Подтверждено. +2 балла.");
      sendCongratsAndTomorrow(chatId, name);
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data === "duty_reject") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Отклонять может только админ." });
        return;
      }
      if (data.dutyStatus !== "pending") {
        bot.answerCallbackQuery(q.id, { text: "Уже обработано." });
        return;
      }
      const name = todayPerson();
      data.dutyStatus = "rejected";
      save();
      bot.sendMessage(
        chatId,
        `❌ Отклонено. ${name}, ещё не все задания выполнены — сделай всё по списку и нажми «Выполнено» снова.`
      );
      sendTasksWithButton(chatId);
      bot.answerCallbackQuery(q.id);
      return;
    }

    // ----- Админ -----
    if (q.data === "admin:hardcore") {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      data.hardcore = !data.hardcore;
      save();
      bot.sendMessage(chatId, `😈 Жёсткий режим: ${data.hardcore ? "ВКЛ" : "ВЫКЛ"}`);
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
      const raw = getTasksRaw();
      const rows = [];
      for (let i = 0; i < raw.length; i++) {
        const t = normalizeTask(raw[i]);
        const label = `${i + 1}. ${t.text.slice(0, 25)}${t.text.length > 25 ? "…" : ""}`;
        rows.push([
          { text: "✏️", callback_data: `task_edit:${i}` },
          { text: "🗑", callback_data: `task_del:${i}` },
        ]);
      }
      if (rows.length === 0) {
        bot.sendMessage(chatId, "Нет заданий. Добавьте через Админ → Добавить задание.");
      } else {
        const list = raw.map((t, i) => `${i + 1}. ${normalizeTask(t).text} (${normalizeTask(t).period === "daily" ? "ежедн." : "нед."})`).join("\n");
        bot.sendMessage(chatId, "Удалить или редактировать:\n\n" + list, {
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
      bot.sendMessage(chatId, `⏭ Дежурный заменён. Теперь: **${todayPerson()}**`, { parse_mode: "Markdown" });
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data && q.data.startsWith("task_del:")) {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      const idx = parseInt(q.data.replace("task_del:", ""), 10);
      if (!data.tasks) data.tasks = getTasksRaw().map(normalizeTask);
      else data.tasks = data.tasks.map(normalizeTask);
      if (idx >= 0 && idx < data.tasks.length) {
        const removed = data.tasks.splice(idx, 1)[0];
        const text = typeof removed === "string" ? removed : (removed.text || "");
        if (data.tasks.length === 0) data.tasks = null;
        save();
        bot.sendMessage(chatId, `🗑 Удалено: «${text}»`);
      }
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data && q.data.startsWith("task_edit:")) {
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      const idx = parseInt(q.data.replace("task_edit:", ""), 10);
      if (!data.tasks) data.tasks = getTasksRaw().map(normalizeTask);
      else data.tasks = data.tasks.map(normalizeTask);
      if (idx >= 0 && idx < data.tasks.length) {
        waitingForTaskEdit = { userId: fromId, index: idx };
        const t = normalizeTask(data.tasks[idx]);
        bot.sendMessage(chatId, `Напишите новый текст для задания:\n«${t.text}»`);
      }
      bot.answerCallbackQuery(q.id);
      return;
    }

    bot.answerCallbackQuery(q.id);
  });

  const app = express();
  const PORT = process.env.PORT || 3000;
  app.get("/", (req, res) => res.send("bot alive"));
  app.listen(PORT, () => console.log("Server running", PORT));

  console.log("🤖 Family bot started");
  if (process.env.GITHUB_GIST_TOKEN && process.env.GITHUB_GIST_ID) console.log("📦 Data: GitHub Gist");
  else if (process.env.MONGODB_URI) console.log("📦 Data: MongoDB");
  else console.log("📦 Data: data.json (local)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
