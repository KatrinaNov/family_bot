const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");

/*
  Инициализация файла, если его нет
*/
function initFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      version: 1,
      chats: {}
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

/*
  Загружаем все данные (если файла нет, создаем)
*/
function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  } catch (err) {
    if (err.code === "ENOENT") {
      initFile();
      return load();
    } else {
      throw err;
    }
  }
}

/*
  Безопасное сохранение (через временный файл)
*/
function save(data) {
  const tempFile = DATA_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

/*
  Получить или создать чат
*/
function getChat(chatId) {
  const data = load();

  if (!data.chats[chatId]) {
    data.chats[chatId] = {
      members: {},
      schedule: {
        order: [],
        currentIndex: 0
      },
      currentDuty: null,
      history: [],
      settings: {
        hardcore: false,
        minConfirmations: 1
      }
    };
    save(data);
  }

  return data.chats[chatId];
}

/*
  Обновить конкретный чат
*/
function updateChat(chatId, chatData) {
  const data = load();
  data.chats[chatId] = chatData;
  save(data);
}

initFile(); // гарантируем наличие файла при старте

module.exports = {
  load,
  save,
  getChat,
  updateChat
};