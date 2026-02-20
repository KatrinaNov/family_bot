const fs = require("fs");

const DATA_FILE = "data.json";

/*
  Загружаем все данные
*/
function load() {
  return JSON.parse(fs.readFileSync(DATA_FILE));
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

module.exports = {
  load,
  save,
  getChat,
  updateChat
};