/**
 * Хранилище данных. Работа с data.json.
 * Все операции синхронные; при необходимости можно заменить на async/БД.
 */
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "..", "data.json");
const logger = require("../lib/logger");

function initFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = { version: 2, chats: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    logger.info("Created data.json");
  }
}

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      initFile();
      return load();
    }
    logger.error("Storage load error", err);
    throw err;
  }
}

/** Сохранение через временный файл (атомарность) */
function save(data) {
  const tempFile = DATA_FILE + ".tmp." + process.pid;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
    // На Windows rename поверх существующего файла может падать.
    // Делаем best-effort атомарную замену с fallback на copyFile.
    try {
      fs.renameSync(tempFile, DATA_FILE);
    } catch (err) {
      try {
        fs.copyFileSync(tempFile, DATA_FILE);
      } catch (copyErr) {
        logger.error("Storage save error (rename/copy)", { err, copyErr });
        throw copyErr;
      }
    }
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

/** Получить или создать чат. Миграция: дополняем старые чаты полями tasks и settings.adminIds */
function getChat(chatId) {
  const data = load();
  const key = String(chatId);
  let dirty = false;
  if (!data.chats[key]) {
    data.chats[key] = {
      members: {},
      schedule: { order: [], currentIndex: 0 },
      currentDuty: null,
      history: [],
      tasks: [],
      settings: { adminId: null, minConfirmations: 1, timezone: "Europe/Minsk" },
    };
    dirty = true;
  }
  const chat = data.chats[key];
  if (!Array.isArray(chat.tasks)) {
    chat.tasks = [];
    dirty = true;
  }
  if (!chat.settings) {
    chat.settings = {};
    dirty = true;
  }
  // Миграция: старый adminIds → один adminId (берём первого)
  if (Array.isArray(chat.settings.adminIds) && chat.settings.adminIds.length > 0) {
    chat.settings.adminId = chat.settings.adminIds[0];
    chat.settings.adminIds = undefined;
    dirty = true;
  }
  if (chat.settings.adminId === undefined) {
    chat.settings.adminId = null;
    dirty = true;
  }

  if (dirty) save(data);
  return chat;
}

/** Обновить чат (перезаписать объект чата) */
function updateChat(chatId, chatData) {
  const data = load();
  data.chats[String(chatId)] = chatData;
  save(data);
}

initFile();

module.exports = {
  load,
  save,
  getChat,
  updateChat,
};
