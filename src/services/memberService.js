/**
 * Сервис участников: добавление, получение, бейджи, роли.
 */
const { getChat, updateChat } = require("../storage/storage");
const config = require("../../config");

function addMember(chatId, user) {
  const chat = getChat(chatId);
  const id = user.id;
  if (chat.members[id]) return false;
  chat.members[id] = {
    id,
    name: user.first_name || user.username || "User",
    username: user.username || null,
    role: "member",
    stats: {
      points: 0,
      streak: 0,
      badges: [],
      streakBadges: [],
      dutyCount: 0,
      confirmedCount: 0,
      rejectedCount: 0,
      autoConfirmedCount: 0,
    },
  };
  if (!chat.schedule.order.includes(id)) chat.schedule.order.push(id);
  updateChat(chatId, chat);
  return true;
}

function getMember(chatId, userId) {
  const chat = getChat(chatId);
  return chat.members[userId] || null;
}

function getAllMembers(chatId) {
  const chat = getChat(chatId);
  return Object.values(chat.members || {});
}

function updateBadges(member) {
  if (!member || !member.stats) return;
  const earned = config.badges.filter((b) => member.stats.points >= b.points).map((b) => b.name);
  member.stats.badges = earned;
  const streakEarned = config.streakBadges.filter((b) => member.stats.streak >= b.streak).map((b) => b.name);
  member.stats.streakBadges = streakEarned;
}

/** Добавить админа по userId */
function addAdmin(chatId, userId) {
  const chat = getChat(chatId);
  if (!chat.settings.adminIds) chat.settings.adminIds = [];
  if (chat.settings.adminIds.includes(userId)) return false;
  chat.settings.adminIds.push(userId);
  updateChat(chatId, chat);
  return true;
}

function isAdmin(chatId, userId) {
  const chat = getChat(chatId);
  return (chat.settings.adminIds || []).includes(userId);
}

module.exports = {
  addMember,
  getMember,
  getAllMembers,
  updateBadges,
  addAdmin,
  isAdmin,
};
