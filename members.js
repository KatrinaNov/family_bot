const { getChat, updateChat } = require("./storage");
const config = require("./config");

/* Добавление участника */
function addMember(chatId, user) {
  const chat = getChat(chatId);
  if (!chat.members[user.id]) {
    chat.members[user.id] = {
      id: user.id,
      name: user.first_name || user.username,
      role: "member",
      stats: {
        points: 0,
        streak: 0,
        badges: [],
        streakBadges: []
      }
    };
    chat.schedule.order.push(user.id);
    updateChat(chatId, chat);
    return true;
  }
  return false;
}

/* Получить участника */
function getMember(chatId, userId) {
  const chat = getChat(chatId);
  return chat.members[userId];
}

/* Получить бейджи по очкам и стрику */
function updateBadges(member) {
  // Очковые бейджи
  const earned = config.badges.filter(b => member.stats.points >= b.points)
                              .map(b => b.name);
  member.stats.badges = earned;

  // Стрик бейджи
  const streakEarned = config.streakBadges.filter(b => member.stats.streak >= b.streak)
                                          .map(b => b.name);
  member.stats.streakBadges = streakEarned;
}

module.exports = {
  addMember,
  getMember,
  updateBadges
};