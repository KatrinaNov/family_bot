const { getChat, updateChat } = require("./storage");

/*
  Добавление участника
*/
function addMember(chatId, user) {
  const chat = getChat(chatId);

  if (!chat.members[user.id]) {
    chat.members[user.id] = {
      id: user.id,
      name: user.first_name || user.username,
      role: "member",
      stats: {
        points: 0,
        fails: 0,
        streak: 0
      }
    };

    chat.schedule.order.push(user.id);
    updateChat(chatId, chat);

    return true;
  }

  return false;
}

/*
  Получить участника
*/
function getMember(chatId, userId) {
  const chat = getChat(chatId);
  return chat.members[userId];
}

module.exports = {
  addMember,
  getMember
};