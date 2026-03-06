/**
 * Конфигурация бота: задачи по умолчанию, очки, бейджи, cron.
 */
module.exports = {
  timezone: "Europe/Minsk",

  /** Задачи по умолчанию при первом запуске (миграция из старого формата в новый) */
  defaultTasks: [
    { title: "🍽 Помыть посуду", description: "", intervalType: "daily", intervalValue: 1, points: 1 },
    { title: "🗑 Собрать мусор", description: "", intervalType: "daily", intervalValue: 1, points: 1 },
    { title: "🧸 Разложить вещи", description: "", intervalType: "daily", intervalValue: 1, points: 1 },
    { title: "🧽 Вытереть пыль", description: "", intervalType: "weekly", intervalValue: 7, points: 1 },
    { title: "🧺 Стирка (если есть)", description: "", intervalType: "weekly", intervalValue: 7, points: 2 },
    { title: "👕 Разобрать стирку", description: "", intervalType: "weekly", intervalValue: 7, points: 1 },
    { title: "🧹 Пылесос", description: "", intervalType: "weekly", intervalValue: 7, points: 2 },
  ],

  points: {
    /** Баллы за подтверждённое дежурство (сумма баллов задач или фикс) */
    perDuty: 2,
    /** Штраф за отклонение не используется отдельно; можно добавить */
    fineRejected: 0,
  },

  /** Количество подтверждений от семьи (в новой логике — только админ подтверждает) */
  minConfirmations: 1,

  badges: [
    { name: "🟢 Новичок", points: 5 },
    { name: "🔵 Помощник", points: 10 },
    { name: "🟣 Опытный", points: 20 },
    { name: "🟡 Мастер", points: 50 },
    { name: "🏆 Легенда", points: 100 },
  ],

  streakBadges: [
    { name: "🔥 3 дня подряд", streak: 3 },
    { name: "💪 7 дней подряд", streak: 7 },
    { name: "🚀 14 дней подряд", streak: 14 },
    { name: "🌟 30 дней подряд", streak: 30 },
  ],

  /** Cron: утреннее уведомление (09:00) */
  cronMorning: "0 9 * * *",
  /** Cron: авто-подтверждение в 23:00 */
  cronAutoConfirm: "0 23 * * *",
  /** Cron: вечернее напоминание (20:00) если задания не отмечены */
  cronEveningReminder: "0 20 * * *",
};
