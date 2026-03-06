/**
 * UI helpers: единый стиль сообщений и клавиатур.
 * Используем HTML parse_mode, чтобы избежать проблем с экранированием Markdown.
 */

function escapeHtml(input) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replyMenuKeyboard() {
  return {
    keyboard: [
      ["📋 Задачи", "👤 Дежурный"],
      ["📊 Статистика", "🏆 Рейтинг"],
      ["⚙️ Админ", "ℹ️ Помощь"],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "Выберите пункт меню…",
  };
}

function inlineDoneButton() {
  return { inline_keyboard: [[{ text: "✅ Задачи выполнены", callback_data: "duty:done" }]] };
}

function header(title, subtitle) {
  let text = `<b>${escapeHtml(title)}</b>`;
  if (subtitle) text += `\n${escapeHtml(subtitle)}`;
  return text;
}

function homeCard({ hasFamily }) {
  if (!hasFamily) {
    return header("🏠 Семейный бот", "Чтобы начать, каждый участник нажимает «ℹ️ Помощь» и делает /join.");
  }
  return header("🏠 Семейный бот", "Выберите действие в меню ниже.");
}

function tasksCard({ dateStr, personName, tasks }) {
  let text = `<b>📋 Задачи на сегодня</b>\n`;
  if (dateStr) text += `<i>${escapeHtml(dateStr)}</i>\n`;
  text += `\n👤 Дежурный: <b>${escapeHtml(personName)}</b>\n\n`;
  if (!tasks || tasks.length === 0) {
    text += "Сегодня задач нет.";
    return text;
  }
  text += tasks.map((t) => `• ${escapeHtml(t.title ?? t)}`).join("\n");
  return text;
}

function whoCard({ personName }) {
  if (!personName) return `<b>👤 Кто дежурный</b>\n\nНет участников. Нажмите «ℹ️ Помощь».`;
  return `<b>👤 Кто дежурный</b>\n\nСегодня дежурный: <b>${escapeHtml(personName)}</b>`;
}

function statsCard(stats) {
  if (!stats) return `<b>📊 Статистика</b>\n\nВы не в семье. Нажмите «ℹ️ Помощь».`;
  const badges = (stats.badges || []).join(" ") || "—";
  const streakBadges = (stats.streakBadges || []).join(" ") || "—";
  return (
    `<b>📊 Статистика</b>\n` +
    `👤 <b>${escapeHtml(stats.name)}</b>\n\n` +
    `⭐ Очки: <b>${escapeHtml(stats.points)}</b>\n` +
    `🔥 Стрик: <b>${escapeHtml(stats.streak)}</b>\n\n` +
    `Дежурств: ${escapeHtml(stats.dutyCount)}\n` +
    `✓ Подтверждено: ${escapeHtml(stats.confirmedCount)}\n` +
    `✗ Отклонено: ${escapeHtml(stats.rejectedCount)}\n` +
    `⏱ Авто: ${escapeHtml(stats.autoConfirmedCount)}\n` +
    `😴 Пропусков: ${escapeHtml(stats.missedCount ?? 0)}\n\n` +
    `🏅 Бейджи: ${escapeHtml(badges)}\n` +
    `🔥 Стрик-бейджи: ${escapeHtml(streakBadges)}`
  );
}

function ratingCard(rating) {
  let text = `<b>🏆 Рейтинг</b>\n\n`;
  if (!rating || rating.length === 0) return text + "Пока никого. Нажмите «ℹ️ Помощь».";
  const medals = ["🥇", "🥈", "🥉"];
  text += rating
    .map((r, i) => {
      const medal = medals[i] || "•";
      return `${medal} <b>${escapeHtml(r.name)}</b> — ${escapeHtml(r.points)} очков <i>(стрик ${escapeHtml(r.streak)})</i>`;
    })
    .join("\n");
  return text;
}

function adminCard({ isAdmin }) {
  if (!isAdmin) {
    return `<b>⚙️ Админ</b>\n\nДоступ только для админа.\nНазначить админа: /setadmin`;
  }
  return `<b>⚙️ Админ</b>\n\nУправление задачами и дежурными:`;
}

function helpCard({ adminIsSet }) {
  let text =
    `<b>ℹ️ Помощь</b>\n\n` +
    `✅ Команды не обязательны — используйте кнопки меню внизу.\n\n` +
    `Если вы ещё не в семье:\n` +
    `1) Напишите: <code>/join</code>\n` +
    `2) (Один раз) назначьте админа: <code>/setadmin</code>\n\n` +
    `Совет: закрепите это сообщение в чате (⋮ → «Закрепить»), чтобы меню и подсказки всегда были под рукой.\n`;
  if (!adminIsSet) text += `\n⚠️ Админ ещё не назначен.\n`;
  return text;
}

function eveningReminderCard({ personName }) {
  return (
    `<b>⏰ Вечернее напоминание</b>\n\n` +
    `👤 Дежурный: <b>${escapeHtml(personName)}</b>\n` +
    `Если задачи выполнены — нажмите кнопку ниже.`
  );
}

function morningCard({ personName, tasks }) {
  let text = `<b>Доброе утро 🌞</b>\n`;
  text += `Сегодня дежурный: <b>${escapeHtml(personName)}</b>\n\n`;
  text += `<b>Список задач</b>\n`;
  text += (tasks && tasks.length ? tasks.map((t) => `• ${escapeHtml(t.title)}`).join("\n") : "Сегодня задач нет.");
  return text;
}

function confirmedCard({ name, points, mode }) {
  const why = mode === "auto" ? "Задачи автоматически засчитаны ✅" : "Задачи подтверждены 👍";
  return `${why}\n\n👤 ${escapeHtml(name)}\n⭐ Баллы начислены: <b>${escapeHtml(points)}</b>`;
}

function tomorrowCard({ personName }) {
  return `👤 <b>Завтра дежурный:</b> ${escapeHtml(personName)}`;
}

module.exports = {
  escapeHtml,
  replyMenuKeyboard,
  inlineDoneButton,
  homeCard,
  tasksCard,
  whoCard,
  statsCard,
  ratingCard,
  adminCard,
  helpCard,
  eveningReminderCard,
  morningCard,
  confirmedCard,
  tomorrowCard,
};

