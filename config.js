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
  
    minConfirmations: 1
  };