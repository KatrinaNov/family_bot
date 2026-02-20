module.exports = {
    timezone: "Europe/Minsk",
  
    defaultTasks: [
      { text: "🍽 Помыть посуду", type: "daily" },
      { text: "🗑 Собрать мусор", type: "daily" },
      { text: "🧸 Разложить вещи", type: "daily" },
      { text: "🧽 Вытереть пыль", type: "one-time" },
      { text: "🧺 Стирка (если есть)", type: "weekend" },
      { text: "👕 Разобрать стирку", type: "weekend" },
      { text: "🧹 Пылесос", type: "daily" }
    ],
  
    points: {
      full: 2,
      partial: 1,
      fineNormal: 2,
      fineHardcore: 5
    },
  
    minConfirmations: 1,
  
    badges: [
      { name: "🟢 Новичок", points: 5 },
      { name: "🔵 Помощник", points: 10 },
      { name: "🟣 Опытный", points: 20 },
      { name: "🟡 Мастер", points: 50 },
      { name: "🏆 Легенда", points: 100 }
    ],
  
    streakBadges: [
      { name: "🔥 3 дня подряд", streak: 3 },
      { name: "💪 7 дней подряд", streak: 7 },
      { name: "🚀 14 дней подряд", streak: 14 },
      { name: "🌟 30 дней подряд", streak: 30 }
    ]
  };