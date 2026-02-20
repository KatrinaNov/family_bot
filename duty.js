const { getChat, updateChat } = require("./storage");
const config = require("./config");

/*
  Определить сегодняшнего дежурного
*/
function getTodayPerson(chatId) {
  const chat = getChat(chatId);

  if (chat.schedule.order.length === 0) return null;

  const index = chat.schedule.currentIndex % chat.schedule.order.length;
  return chat.members[chat.schedule.order[index]];
}

/*
  Создать дежурство на день
*/
function createDuty(chatId) {
  const chat = getChat(chatId);
  const person = getTodayPerson(chatId);

  if (!person) return null;

  chat.currentDuty = {
    date: new Date().toISOString().split("T")[0],
    userId: person.id,
    status: "active",
    tasks: config.defaultTasks.map((t, i) => ({
      id: i + 1,
      text: t,
      done: false
    })),
    confirmations: []
  };

  updateChat(chatId, chat);

  return chat.currentDuty;
}

/*
  Переключить дежурного
*/
function nextDuty(chatId) {
  const chat = getChat(chatId);
  chat.schedule.currentIndex++;
  chat.currentDuty = null;
  updateChat(chatId, chat);
}

module.exports = {
  getTodayPerson,
  createDuty,
  nextDuty
};