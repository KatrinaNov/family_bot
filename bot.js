require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");
const storage = require("./storageBot");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;

let data;

const TASKS = [
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

function save() {
  storage.save(data).catch((err) => console.error("Save error", err));
}

function mainMenu(chatId) {
  bot.sendMessage(chatId, "🏠 Семейное меню", {
    reply_markup: {
      keyboard: [
        ["📅 Кто сегодня", "📋 Список дел"],
        ["🏆 Рейтинг", "📊 Статистика"],
        ["⏭ Пропустить", "😈 Жесткий режим"],
      ],
      resize_keyboard: true,
    },
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
/test — тест дежурного

или пользуйся кнопками 👇`
    );
    mainMenu(msg.chat.id);
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
    TASKS.forEach((t) => (text += "• " + t + "\n"));
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

  // ---- Кнопки меню ----
  bot.on("message", (msg) => {
    const t = msg.text;
    if (t === "📅 Кто сегодня") bot.sendMessage(data.chatId, `Сегодня: ${todayPerson()}`);
    if (t === "📋 Список дел") {
      let text = "📋 Дела:\n\n";
      TASKS.forEach((a) => (text += "• " + a + "\n"));
      bot.sendMessage(data.chatId, text);
    }
    if (t === "🏆 Рейтинг")
      bot.sendMessage(data.chatId, Object.entries(data.stats).map((e) => e.join(": ")).join("\n"));
    if (t === "📊 Статистика")
      bot.sendMessage(data.chatId, Object.entries(data.fails).map((e) => e.join(": ") + " косяков").join("\n"));
    if (t === "⏭ Пропустить") bot.emit("text", { text: "/skip", chat: msg.chat, from: msg.from });
    if (t === "😈 Жесткий режим") bot.emit("text", { text: "/hardcore", chat: msg.chat, from: msg.from });
  });

  // ---- Утро 6:00 — мем ----
  cron.schedule(
    "0 6 * * *",
    async () => {
      if (data.chatId) await sendMorningMeme(data.chatId);
    },
    { timezone: "Europe/Berlin" }
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
      TASKS.forEach((t) => (text += "• " + t + "\n"));

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
    const name = todayPerson();
    if (!name) {
      bot.answerCallbackQuery(q.id, { text: "Сначала добавьте участников: /join" });
      return;
    }
    const fromId = q.from.id;
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
      const canConfirm = ADMIN_ID ? fromId === ADMIN_ID : fromId !== dutyUserId && fromId !== undefined;
      if (!canConfirm) {
        bot.answerCallbackQuery(q.id, {
          text: ADMIN_ID ? "Подтверждать может только админ" : "Подтверждать должен другой участник (не дежурный)",
        });
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
      const canReject = ADMIN_ID ? fromId === ADMIN_ID : fromId !== dutyUserId && fromId !== undefined;
      if (!canReject) {
        bot.answerCallbackQuery(q.id, {
          text: ADMIN_ID ? "Отклонять может только админ" : "Отклонять должен другой участник (не дежурный)",
        });
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
