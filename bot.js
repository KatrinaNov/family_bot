require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");
const path = require("path");
const fs = require("fs");
const storage = require("./storageBot");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID_ENV = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;
const TZ = "Europe/Minsk";

let data;
let waitingForTaskFrom = null;
let waitingForTaskEdit = null;
let waitingCalendar = null;
let waitingCalendarEdit = null;

const EVENT_TYPES = [
  { id: "circle", label: "Кружок", emoji: "🎯" },
  { id: "event", label: "Мероприятие", emoji: "📌" },
  { id: "family", label: "Для родных", emoji: "👨‍👩‍👧‍👦" },
  { id: "other", label: "Другое", emoji: "📅" },
];

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

function getTodayMinskStr() {
  return new Date().toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 10);
}

function getTomorrowMinskStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 10);
}

function getEventsForDate(dateStr) {
  if (!data.events || !data.events.length) return [];
  return data.events.filter((e) => e.date === dateStr).sort((a, b) => (a.time || "00:00").localeCompare(b.time || "00:00"));
}

function getUpcomingEvents(limitDays = 90) {
  if (!data.events || !data.events.length) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + limitDays);
  return data.events
    .filter((e) => {
      const d = new Date(e.date);
      d.setHours(0, 0, 0, 0);
      return d >= today && d <= end;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function formatEventDate(ymd) {
  const d = new Date(ymd + "T12:00:00");
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const w = weekdays[d.getDay()];
  return `${day.toString().padStart(2, "0")}.${month.toString().padStart(2, "0")} (${w})`;
}

function parseDateInput(str) {
  const s = str.trim().replace(/\s+/g, " ");
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/);
  if (!m) return null;
  let day = parseInt(m[1], 10);
  let month = parseInt(m[2], 10) - 1;
  let year = parseInt(m[3], 10) || new Date().getFullYear();
  if (year < 100) year += 2000;
  const d = new Date(year, month, day);
  if (isNaN(d.getTime()) || d.getMonth() !== month) return null;
  const y = d.getFullYear();
  const mo = (d.getMonth() + 1).toString().padStart(2, "0");
  const da = d.getDate().toString().padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function parseTimeInput(str) {
  const s = str.trim().toLowerCase();
  if (s === "пропустить" || s === "-" || s === "") return "";
  const m = s.match(/^(\d{1,2})[.:](\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function save() {
  storage.save(data).catch((err) => console.error("Save error", err));
}

function escapeMarkdown(str) {
  if (str == null || typeof str !== "string") return "";
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[");
}

function escapeMarkdown(str) {
  if (str == null || typeof str !== "string") return "";
  return str.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/`/g, "\\`").replace(/\[/g, "\\[");
}

function mainMenu(chatId, userId) {
  let rows;
  if (userId != null && !isMember(userId)) {
    rows = [["👋 Вступить в семью"], ["ℹ️ Помощь"]];
  } else {
    rows = [
      ["📅 Кто сегодня", "📋 Задачи на сегодня"],
      ["📅 Календарь", "🏆 Рейтинг"],
      ["📊 Статистика", "ℹ️ Помощь"],
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
  let text = `📋 Сегодня дежурит: **${escapeMarkdown(name || "—")}**\n\n`;
  text += tasks.length ? tasks.map((t) => "• " + escapeMarkdown(t)).join("\n") : "Нет заданий на сегодня.";
  const opts = { parse_mode: "Markdown" };
  if (name && tasks.length) {
    opts.reply_markup = {
      inline_keyboard: [[{ text: "✅ Выполнено", callback_data: "duty_done" }]],
    };
  }
  return bot.sendMessage(chatId, text, opts);
}

function formatEventLine(e) {
  const typeInfo = EVENT_TYPES.find((t) => t.id === e.type) || EVENT_TYPES[3];
  const timePart = e.time ? ` ${e.time}` : "";
  return `${typeInfo.emoji} ${e.title}${timePart}`;
}

function sendCalendarList(chatId, userId) {
  const upcoming = getUpcomingEvents(90);
  let text = "📅 **Ближайшие события (3 месяца)**\n\n";
  if (upcoming.length === 0) {
    text += "Пока ничего не запланировано.";
  } else {
    const byDate = {};
    upcoming.forEach((e) => {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    });
    Object.keys(byDate)
      .sort()
      .forEach((date) => {
        text += `${formatEventDate(date)}\n`;
        byDate[date].forEach((e) => {
          text += `  ${escapeMarkdown(formatEventLine(e))}\n`;
        });
        text += "\n";
      });
  }
  const opts = { parse_mode: "Markdown" };
  const rows = [];
  if (userId != null && isMember(userId)) {
    rows.push([{ text: "➕ Добавить событие", callback_data: "calendar:add" }]);
  }
  upcoming.slice(0, 20).forEach((e) => {
    const row = [{ text: "📄", callback_data: `calendar:show:${e.id}` }];
    if (isAdmin(userId)) row.push({ text: "✏️", callback_data: `calendar:edit:${e.id}` }, { text: "🗑", callback_data: `calendar:del:${e.id}` });
    rows.push(row);
  });
  if (rows.length) opts.reply_markup = { inline_keyboard: rows };
  bot.sendMessage(chatId, text.trim(), opts);
}

function sendCongratsAndTomorrow(chatId, completedName) {
  const tomorrowPerson = todayPerson();
  bot.sendMessage(
    chatId,
    `🎉 Молодец, ${escapeMarkdown(completedName)}! +2 балла в рейтинг.\n\nЗавтра дежурит: **${escapeMarkdown(
      tomorrowPerson
    )}**`,
    { parse_mode: "Markdown" }
  );
}

const LOCAL_MEMES = [
  // Примеры. Положите свои файлы в папку ./images и замените пути/тексты.
  {
    image: "images/meme1.webp",
    text: "Интересный факт: На Луне нет ветра, поэтому следы астронавтов останутся там навсегда.",
  },
  {
    image: "images/meme2.jpg",
    text: "Интересный факт: На Юпитере и Сатурне атмосферное давление настолько высокое, что углерод превращается в алмазы.",
  },
  {
    image: "images/meme3.jpg",
    text: "Интересный факт: совместные бытовые дела снижают уровень стресса в семье — главное, чтобы награда была не только баллами, но и благодарностью.",
  },
  {
    image: "images/meme4.jpg",
    text: "Интересный факт: Каждый день на Землю падает около 200 тысяч метеоритов.",
  },
  {
    image: "images/meme5.jpg",
    text: "Интересный факт: Попугаи Кеа живут в Новой Зеландии и иногда охотятся на овец.",
  },
  {
    image: "images/meme6.jpg",
    text: "Память золотой рыбки длится около 3 секунд.",
  },
  {
    image: "images/meme7.jpg",
    text: "Интересный факт: Самый популярный напиток в мире — кофе. Ежегодно люди употребляют около 400 млрд. чашек.",
  },
  {
    image: "images/meme8.jpg",
    text: "Интересный факт: А вы Знали что Сникерс назвали в честь любимой лошади, принадлежавшей семье кондитера Фрэнка Марса?",
  },
  {
    image: "images/meme9.jpg",
    text: "Интересный факт: Самая длинная медуза, измеренная человеком, составляла в длину почти 50 метров — половину длины футбольного поля.",
  },
  {
    image: "images/meme10.webp",
    text: "Интересный факт: У медуз нет мозгов и кровеносных сосудов.",
  },
  {
    image: "images/meme11.jpg",
    text: "Интересный факт: Чайная ложка мёда – результат работы всей жизни 12 пчёл.",
  },
  {
    image: "images/meme12.jpeg",
    text: "Интересный факт: Самая крупная жемчужина в мире достигает 6 килограммов в весе.",
  },
  {
    image: "images/meme13.jpg",
    text: "Интересный факт: Законодательство США допускало отправку детей по почте до 1913 года.",
  },
  {
    image: "images/meme14.jpg",
    text: "Интересный факт: Среднее облако весит порядка 500 тонн, столько же весят 80 слонов.",
  },
  {
    image: "images/meme15.jpg",
    text: "Интересный факт: Скорость распространения лавы после извержения, близка к скорости бега гончей.",
  },
  {
    image: "images/meme16.jpeg",
    text: "Интересный факт: Изначально, отвертка была изобретена для выковыривания гвоздей, шуруп был изобретен на 100 лет позже.",
  },
  {
    image: "images/meme17.jpg",
    text: "Интересный факт: В Антарктиде существует единственная река – Оникс, она течет всего 60 дней в году",
  }
];

async function sendMorningMeme(chatId) {
  const fallback = () =>
    bot.sendMessage(chatId, "☀️ Доброе утро! Хорошего дня 😄").catch(() => {});

  try {
    if (!Array.isArray(LOCAL_MEMES) || LOCAL_MEMES.length === 0) {
      return fallback();
    }
    const idx = Math.floor(Math.random() * LOCAL_MEMES.length);
    const meme = LOCAL_MEMES[idx];

    // Локальный файл (из папки ./memes)
    if (meme.file) {
      const filePath = path.join(__dirname, meme.file);
      if (fs.existsSync(filePath)) {
        if (meme.text) {
          await bot.sendPhoto(chatId, filePath, {
            caption: `☀️ Мем на старт дня\n\n${meme.text}`,
          });
        } else {
          await bot.sendPhoto(chatId, filePath, {
            caption: "☀️ Мем на старт дня",
          });
        }
        return;
      }
    }

    // Запас: если указан внешний URL
    if (meme.image) {
      if (meme.text) {
        await bot.sendPhoto(chatId, meme.image, {
          caption: `☀️ Мем на старт дня\n\n${meme.text}`,
        });
      } else {
        await bot.sendPhoto(chatId, meme.image, {
          caption: "☀️ Мем на старт дня",
        });
      }
      return;
    }

    if (meme.text) {
      await bot.sendMessage(chatId, `☀️ Мем‑факт на утро:\n\n${meme.text}`);
      return;
    }
  } catch (e) {
    console.error("Local meme error", e.message);
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
  if (!Array.isArray(data.events)) data.events = [];
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
• Админ может: добавить/удалить/редактировать задания, заменить дежурного
• **Календарь** — события, кружки, мероприятия. Любой участник может добавить; у события можно указать время и описание; админ может редактировать и удалять. Напоминания: в 9:00 — что сегодня, в 20:00 — что завтра, за 2 часа до времени события`;
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

    // Ожидание ввода для календаря (добавление события)
    if (waitingCalendar && waitingCalendar.userId === userId && isMember(userId)) {
      if (waitingCalendar.step === 1) {
        const dateStr = parseDateInput(t);
        if (!dateStr) {
          bot.sendMessage(chatId, "Неверный формат. Введите дату: ДД.ММ или ДД.ММ.ГГГГ (например 25.03 или 25.03.2025)");
          return;
        }
        waitingCalendar.date = dateStr;
        waitingCalendar.step = 2;
        bot.sendMessage(chatId, "Введите название события (например: Концерт в школе, Плавание):");
        return;
      }
      if (waitingCalendar.step === 2) {
        waitingCalendar.title = t.trim().slice(0, 200);
        waitingCalendar.step = 3;
        const buttons = EVENT_TYPES.map((type) => ({
          text: `${type.emoji} ${type.label}`,
          callback_data: `calendar:type:${type.id}`,
        }));
        bot.sendMessage(chatId, "Выберите тип события:", {
          reply_markup: { inline_keyboard: buttons.map((b) => [b]) },
        });
        return;
      }
      if (waitingCalendar.step === 4) {
        const timeStr = parseTimeInput(t);
        if (timeStr === null) {
          bot.sendMessage(chatId, "Неверный формат. Введите время (например 18:00) или «пропустить»");
          return;
        }
        waitingCalendar.time = timeStr || undefined;
        waitingCalendar.step = 5;
        bot.sendMessage(chatId, "Введите описание события или «пропустить»:");
        return;
      }
      if (waitingCalendar.step === 5) {
        waitingCalendar.description = (t.trim().slice(0, 500) || undefined);
        const event = {
          id: String(Date.now()),
          title: waitingCalendar.title,
          date: waitingCalendar.date,
          type: waitingCalendar.type,
          time: waitingCalendar.time,
          description: waitingCalendar.description,
        };
        data.events = data.events || [];
        data.events.push(event);
        save();
        const typeLabel = (EVENT_TYPES.find((x) => x.id === event.type) || EVENT_TYPES[3]).label;
        waitingCalendar = null;
        bot.sendMessage(chatId, `✅ Добавлено: ${formatEventDate(event.date)}${event.time ? " " + event.time : ""} — ${event.title} (${typeLabel})`);
        sendCalendarList(chatId, userId);
        return;
      }
    }
    waitingCalendar = null;

    // Ожидание ввода при редактировании события
    if (waitingCalendarEdit && waitingCalendarEdit.userId === userId && isAdmin(userId)) {
      const ev = data.events && data.events.find((e) => e.id === waitingCalendarEdit.eventId);
      if (!ev) {
        waitingCalendarEdit = null;
        return;
      }
      const field = waitingCalendarEdit.field;
      if (field === "date") {
        const dateStr = parseDateInput(t);
        if (!dateStr) {
          bot.sendMessage(chatId, "Неверный формат даты. ДД.ММ или ДД.ММ.ГГГГ");
          return;
        }
        ev.date = dateStr;
      } else if (field === "title") {
        ev.title = t.trim().slice(0, 200);
      } else if (field === "time") {
        const timeStr = parseTimeInput(t);
        if (timeStr === null && t.trim().toLowerCase() !== "пропустить") {
          bot.sendMessage(chatId, "Неверный формат. Введите время (18:00) или «пропустить»");
          return;
        }
        ev.time = timeStr || undefined;
      } else if (field === "description") {
        ev.description = t.trim().slice(0, 500) || undefined;
      }
      save();
      waitingCalendarEdit = null;
      bot.sendMessage(chatId, "✅ Изменено.");
      sendCalendarList(chatId, userId);
      return;
    }
    waitingCalendarEdit = null;

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
      bot.sendMessage(chatId, `Сегодня дежурит: **${escapeMarkdown(todayPerson() || "—")}**`, { parse_mode: "Markdown" });
      return;
    }
    if (t === "📅 Календарь") {
      sendCalendarList(chatId, userId);
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

  // ---- Cron 9:00 Минск: напоминание + список с кнопкой + календарь сегодня + мем ----
  cron.schedule(
    "0 9 * * *",
    () => {
      if (!data.chatId) return;
      data.doneToday = false;
      data.dutyStatus = "none";
      data.daySkipped = false;
      save();

      const todayEvents = getEventsForDate(getTodayMinskStr());
      const calendarPromise = todayEvents.length
        ? bot.sendMessage(
            data.chatId,
            "📅 **Сегодня в календаре:**\n\n" + todayEvents.map((e) => escapeMarkdown(formatEventLine(e))).join("\n"),
            { parse_mode: "Markdown" }
          )
        : Promise.resolve();

      sendTasksWithButton(data.chatId)
        .then(() => calendarPromise)
        .then(() => sendMorningMeme(data.chatId))
        .catch((err) => {
          console.error("9:00 cron error", err.message);
          calendarPromise.catch(() => {});
          sendMorningMeme(data.chatId).catch(() => {});
        });
    },
    { timezone: TZ }
  );

  // ---- Cron 20:00 Минск: напоминание дежурному + календарь на завтра ----
  cron.schedule(
    "0 20 * * *",
    () => {
      if (!data.chatId) return;
      const tomorrowEvents = getEventsForDate(getTomorrowMinskStr());
      if (tomorrowEvents.length) {
        bot.sendMessage(
          data.chatId,
          "📅 **Завтра в календаре:**\n\n" + tomorrowEvents.map((e) => escapeMarkdown(formatEventLine(e))).join("\n"),
          { parse_mode: "Markdown" }
        ).catch((err) => console.error("20:00 calendar", err.message));
      }
      if (data.doneToday && data.dutyStatus === "confirmed") return;
      const name = todayPerson();
      bot.sendMessage(
        data.chatId,
        `⏰ Дежурный ${name}: осталось 2 часа. Отметьте выполнение кнопкой «Выполнено», иначе в 22:00 — штраф −2 и завтра снова дежурный.`
      );
    },
    { timezone: TZ }
  );

  // ---- Cron каждый час: напоминание за 2 часа до события (с временем) ----
  cron.schedule(
    "0 * * * *",
    () => {
      if (!data.chatId || !data.events || !data.events.length) return;
      const now = Date.now();
      const twoHours = 2 * 60 * 60 * 1000;
      const window = 30 * 60 * 1000;
      const todayStr = getTodayMinskStr();
      const tomorrowStr = getTomorrowMinskStr();
      data.events.forEach((e) => {
        if (e.reminded2h || !e.time) return;
        if (e.date !== todayStr && e.date !== tomorrowStr) return;
        const eventMoment = new Date(e.date + "T" + e.time + ":00+03:00").getTime();
        const diff = eventMoment - now;
        if (diff >= twoHours - window && diff <= twoHours + window) {
          e.reminded2h = true;
          save();
          const typeInfo = EVENT_TYPES.find((t) => t.id === e.type) || EVENT_TYPES[3];
          bot.sendMessage(
            data.chatId,
            `⏰ Через 2 часа: **${escapeMarkdown(e.title)}** (${typeInfo.emoji} ${typeInfo.label})\n${formatEventDate(e.date)} в ${e.time}`
          );
        }
      });
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

    // ----- Календарь -----
    if (q.data === "calendar:add") {
      if (!isMember(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Вступите в семью, чтобы добавлять события." });
        return;
      }
      waitingCalendar = { step: 1, userId: fromId };
      bot.sendMessage(chatId, "Введите дату: ДД.ММ или ДД.ММ.ГГГГ (например 25.03 или 25.03.2025):");
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data && q.data.startsWith("calendar:type:")) {
      const typeId = q.data.replace("calendar:type:", "");
      if (!waitingCalendar || waitingCalendar.userId !== fromId || waitingCalendar.step !== 3 || !isMember(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Сессия истекла. Откройте календарь → Добавить событие." });
        return;
      }
      waitingCalendar.type = EVENT_TYPES.some((t) => t.id === typeId) ? typeId : "other";
      waitingCalendar.step = 4;
      bot.sendMessage(chatId, "Введите время (например 18:00) или напишите «пропустить»:");
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data && q.data.startsWith("calendar:show:")) {
      const eventId = q.data.replace("calendar:show:", "");
      const e = data.events && data.events.find((ev) => ev.id === eventId);
      if (!e) {
        bot.answerCallbackQuery(q.id, { text: "Событие не найдено." });
        return;
      }
      const typeInfo = EVENT_TYPES.find((t) => t.id === e.type) || EVENT_TYPES[3];
      let detail = `📅 **${escapeMarkdown(e.title)}**\n${formatEventDate(e.date)}${e.time ? " в " + e.time : ""}\n${typeInfo.emoji} ${typeInfo.label}`;
      if (e.description) detail += `\n\n${escapeMarkdown(e.description)}`;
      bot.sendMessage(chatId, detail, { parse_mode: "Markdown" });
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data && q.data.startsWith("calendar:edit:")) {
      const eventId = q.data.replace("calendar:edit:", "");
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ может редактировать." });
        return;
      }
      const e = data.events && data.events.find((ev) => ev.id === eventId);
      if (!e) {
        bot.answerCallbackQuery(q.id, { text: "Событие не найдено." });
        return;
      }
      const typeRows = EVENT_TYPES.map((type) => ({ text: `${type.emoji} ${type.label}`, callback_data: `calendar:editfield:${eventId}:type:${type.id}` }));
      const typeChunks = [typeRows.slice(0, 2), typeRows.slice(2, 4)];
      bot.sendMessage(chatId, "Что изменить?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📅 Дата", callback_data: `calendar:editfield:${eventId}:date` },
              { text: "📝 Название", callback_data: `calendar:editfield:${eventId}:title` },
            ],
            [
              { text: "🕐 Время", callback_data: `calendar:editfield:${eventId}:time` },
              { text: "📄 Описание", callback_data: `calendar:editfield:${eventId}:description` },
            ],
            ...typeChunks,
          ],
        },
      });
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data && q.data.startsWith("calendar:editfield:")) {
      const rest = q.data.replace("calendar:editfield:", "");
      const parts = rest.split(":");
      const eventId = parts[0];
      const field = parts[1];
      const typeId = parts[2];
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ." });
        return;
      }
      const e = data.events && data.events.find((ev) => ev.id === eventId);
      if (!e) {
        bot.answerCallbackQuery(q.id, { text: "Событие не найдено." });
        return;
      }
      if (field === "type" && typeId) {
        e.type = EVENT_TYPES.some((t) => t.id === typeId) ? typeId : "other";
        save();
        bot.sendMessage(chatId, "✅ Тип изменён.");
        sendCalendarList(chatId, fromId);
        bot.answerCallbackQuery(q.id);
        return;
      }
      waitingCalendarEdit = { userId: fromId, eventId, field };
      const prompts = {
        date: "Введите новую дату (ДД.ММ или ДД.ММ.ГГГГ):",
        title: "Введите новое название:",
        time: "Введите время (18:00) или «пропустить»:",
        description: "Введите описание или «пропустить»:",
      };
      bot.sendMessage(chatId, prompts[field] || "Введите значение:");
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (q.data && q.data.startsWith("calendar:del:")) {
      const eventId = q.data.replace("calendar:del:", "");
      if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(q.id, { text: "Только админ может удалять события." });
        return;
      }
      if (data.events) {
        const before = data.events.length;
        data.events = data.events.filter((e) => e.id !== eventId);
        if (data.events.length < before) {
          save();
          bot.sendMessage(chatId, "Событие удалено.");
          sendCalendarList(chatId, fromId);
        }
      }
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
      bot.sendMessage(chatId, `⏭ Дежурный заменён. Теперь: **${escapeMarkdown(todayPerson())}**`, { parse_mode: "Markdown" });
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
