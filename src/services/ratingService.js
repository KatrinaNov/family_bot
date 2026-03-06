/**
 * Сервис рейтинга и статистики: рейтинг по очкам, детальная статистика по участнику.
 */
const { getChat } = require("../storage/storage");

function getRating(chatId) {
  const chat = getChat(chatId);
  const members = Object.values(chat.members || {});
  return members
    .map((m) => ({
      id: m.id,
      name: m.name,
      points: m.stats?.points ?? 0,
      streak: m.stats?.streak ?? 0,
      badges: m.stats?.badges ?? [],
      streakBadges: m.stats?.streakBadges ?? [],
    }))
    .sort((a, b) => b.points - a.points);
}

/**
 * Детальная статистика участника: дежурства, подтверждённые, отклонённые, авто-подтверждения.
 */
function getMemberStats(chatId, userId) {
  const chat = getChat(chatId);
  const member = chat.members[userId];
  if (!member) return null;
  const s = member.stats || {};
  return {
    name: member.name,
    points: s.points ?? 0,
    streak: s.streak ?? 0,
    badges: s.badges ?? [],
    streakBadges: s.streakBadges ?? [],
    dutyCount: s.dutyCount ?? 0,
    confirmedCount: s.confirmedCount ?? 0,
    rejectedCount: s.rejectedCount ?? 0,
    autoConfirmedCount: s.autoConfirmedCount ?? 0,
    missedCount: s.missedCount ?? 0,
  };
}

module.exports = {
  getRating,
  getMemberStats,
};
