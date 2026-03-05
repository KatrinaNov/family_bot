/**
 * Роутер callback_query: разбор data и вызов нужного контроллера.
 * Защита от двойных нажатий: всегда вызываем answerCallbackQuery в конце.
 */
const dutyController = require("./dutyController");
const menuController = require("./menuController");
const adminController = require("./adminController");
const logger = require("../lib/logger");

async function route(bot, query) {
  const data = (query.data || "").split(":");
  const prefix = data[0];

  try {
    if (prefix === "menu") {
      if (data[1] === "back") {
        await menuController.handleMenuBack(bot, query);
        return;
      }
      await menuController.handleMenuCallback(bot, query, data);
      return;
    }

    if (prefix === "duty") {
      const action = data[1];
      if (action === "done") await dutyController.handleDutyDone(bot, query);
      else if (action === "confirm") await dutyController.handleDutyConfirm(bot, query);
      else if (action === "reject") await dutyController.handleDutyReject(bot, query);
      else await bot.answerCallbackQuery(query.id);
      return;
    }

    if (prefix === "admin") {
      const action = data[1];
      const chatId = query.message.chat.id;
      const userId = query.from.id;
      const memberService = require("../services/memberService");
      if (!memberService.isAdmin(chatId, userId) && action !== "add_admin") {
        await bot.answerCallbackQuery(query.id, { text: "Доступ только для админа" });
        return;
      }
      if (action === "add_task") await adminController.handleAdminAddTask(bot, query);
      else if (action === "quick_add") await adminController.handleAdminQuickAddTask(bot, query);
      else if (action === "list_tasks") await adminController.handleAdminListTasks(bot, query);
      else if (action === "del") await adminController.handleAdminDeleteTask(bot, query);
      else if (action === "edit") await adminController.handleAdminEditTask(bot, query);
      else if (action === "set_interval") await adminController.handleAdminSetInterval(bot, query);
      else if (action === "next_duty") await adminController.handleAdminNextDuty(bot, query);
      else await bot.answerCallbackQuery(query.id);
      return;
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    logger.error("Callback handler error", query.data, err);
    try {
      await bot.answerCallbackQuery(query.id, { text: "Ошибка. Попробуйте позже.", show_alert: true });
    } catch (_) {}
  }
}

module.exports = { route };
