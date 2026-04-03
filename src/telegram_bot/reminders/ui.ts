import { InlineKeyboard, type Context } from "grammy";
import type { AppConfig } from "../app/types";
import { t } from "../app/i18n";
import { editMessageTextFormatted } from "../telegram/format";
import type { ReminderEvent, ReminderNotificationInstance, ReminderView } from "./types";
import { formatReminderEvent, getCurrentOccurrence, listNotificationInstances, reminderEventScheduleSummary } from "./schedule";
import { deleteReminderEvent, getReminderEvent, readReminderEvents } from "./store";

const REMINDER_CALLBACK_PREFIX = "reminder:";
const UPCOMING_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function activeEvents(events: ReminderEvent[]): ReminderEvent[] {
  return events.filter((item) => item.status === "active");
}

function filterEvents(events: ReminderEvent[], view: ReminderView): ReminderEvent[] {
  const reminders = activeEvents(events);
  if (view === "all") return reminders;
  if (view === "upcoming") {
    const now = Date.now();
    const end = now + UPCOMING_WINDOW_DAYS * MS_PER_DAY;
    return reminders.filter((item) => {
      const occurrence = getCurrentOccurrence(item);
      if (!occurrence) return false;
      const ts = Date.parse(occurrence.scheduledAt);
      return Number.isFinite(ts) && ts >= now && ts <= end;
    });
  }
  if (view === "routine") return reminders.filter((item) => (item.category || "routine") === "routine");
  if (view === "special") return reminders.filter((item) => item.category === "special");
  if (view === "special:birthday") return reminders.filter((item) => item.specialKind === "birthday");
  if (view === "special:festival") return reminders.filter((item) => item.specialKind === "festival");
  if (view === "special:anniversary") return reminders.filter((item) => item.specialKind === "anniversary");
  if (view === "special:memorial") return reminders.filter((item) => item.specialKind === "memorial");
  return reminders;
}

function menuLabel(config: AppConfig, key: string, count: number): string {
  return `${t(config, key)} ×${count}`;
}

function buildMenuKeyboard(config: AppConfig, events: ReminderEvent[]): InlineKeyboard {
  return new InlineKeyboard()
    .text(menuLabel(config, "reminder_menu_upcoming", filterEvents(events, "upcoming").length), `${REMINDER_CALLBACK_PREFIX}menu:upcoming`).row()
    .text(menuLabel(config, "reminder_menu_routine", filterEvents(events, "routine").length), `${REMINDER_CALLBACK_PREFIX}menu:routine`).row()
    .text(menuLabel(config, "reminder_menu_special", filterEvents(events, "special").length), `${REMINDER_CALLBACK_PREFIX}menu:special`).row()
    .text(menuLabel(config, "reminder_menu_all", filterEvents(events, "all").length), `${REMINDER_CALLBACK_PREFIX}menu:all`);
}

function buildSpecialMenuKeyboard(config: AppConfig, events: ReminderEvent[]): InlineKeyboard {
  return new InlineKeyboard()
    .text(menuLabel(config, "reminder_menu_special_birthday", filterEvents(events, "special:birthday").length), `${REMINDER_CALLBACK_PREFIX}menu:special:birthday`).row()
    .text(menuLabel(config, "reminder_menu_special_festival", filterEvents(events, "special:festival").length), `${REMINDER_CALLBACK_PREFIX}menu:special:festival`).row()
    .text(menuLabel(config, "reminder_menu_special_anniversary", filterEvents(events, "special:anniversary").length), `${REMINDER_CALLBACK_PREFIX}menu:special:anniversary`).row()
    .text(menuLabel(config, "reminder_menu_special_memorial", filterEvents(events, "special:memorial").length), `${REMINDER_CALLBACK_PREFIX}menu:special:memorial`).row()
    .text(t(config, "reminder_back"), `${REMINDER_CALLBACK_PREFIX}menu:root`);
}

function buildListKeyboard(config: AppConfig, events: ReminderEvent[], page: number, view: ReminderView): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageSize = Math.max(1, config.bot.menuPageSize);
  const totalPages = Math.max(1, Math.ceil(events.length / pageSize));
  const start = page * pageSize;
  const pageItems = events.slice(start, start + pageSize);
  pageItems.forEach((item) => keyboard.text(formatReminderEvent(config, item).slice(0, 60), `${REMINDER_CALLBACK_PREFIX}view:${view}:${item.id}`).row());
  if (totalPages > 1) {
    if (page > 0) keyboard.text(t(config, "reminder_prev"), `${REMINDER_CALLBACK_PREFIX}page:${view}:${page - 1}`);
    if (page < totalPages - 1) keyboard.text(t(config, "reminder_next"), `${REMINDER_CALLBACK_PREFIX}page:${view}:${page + 1}`);
    keyboard.row();
  }
  keyboard.text(t(config, "reminder_back"), `${REMINDER_CALLBACK_PREFIX}menu:${view.startsWith("special:") ? "special" : "root"}`);
  return keyboard;
}

function buildDetailKeyboard(config: AppConfig, eventId: string, view: ReminderView): InlineKeyboard {
  return new InlineKeyboard().text(t(config, "reminder_delete"), `${REMINDER_CALLBACK_PREFIX}delete:${view}:${eventId}`).row().text(t(config, "reminder_back"), `${REMINDER_CALLBACK_PREFIX}page:${view}:0`);
}

function buildDeleteConfirmKeyboard(config: AppConfig, eventId: string, view: ReminderView): InlineKeyboard {
  return new InlineKeyboard().text(t(config, "reminder_confirm_delete"), `${REMINDER_CALLBACK_PREFIX}confirm-delete:${view}:${eventId}`).text(t(config, "reminder_cancel"), `${REMINDER_CALLBACK_PREFIX}view:${view}:${eventId}`);
}

function notificationLabel(instance: ReminderNotificationInstance): string {
  return instance.label || `${instance.offsetMinutes}m`;
}

function timeSemanticsLabel(config: AppConfig, event: ReminderEvent): string {
  return t(config, event.timeSemantics === "absolute" ? "reminder_time_semantics_absolute" : "reminder_time_semantics_local");
}

function eventRecipientsLabel(config: AppConfig, event: ReminderEvent): string {
  if (event.targets.length === 0) return t(config, "reminder_recipients_unspecified");
  return event.targets.map((item) => item.displayName || String(item.targetId)).join("、");
}

function eventDetailText(config: AppConfig, event: ReminderEvent): string {
  const notifications = getCurrentOccurrence(event)
    ? listNotificationInstances(event, getCurrentOccurrence(event)!).map((item) => `- ${notificationLabel(item)}`).join("\n")
    : event.notifications.map((item) => `- ${item.label || item.offsetMinutes}`).join("\n");
  return [
    `⏰ ${event.title}`,
    t(config, "reminder_detail_time", { value: reminderEventScheduleSummary(config, event) }),
    t(config, "reminder_detail_recipients", { value: eventRecipientsLabel(config, event) }),
    t(config, "reminder_detail_time_semantics", { value: timeSemanticsLabel(config, event) }),
    ...(event.timeSemantics === "absolute" ? [t(config, "reminder_detail_timezone", { value: event.timezone })] : []),
    t(config, "reminder_detail_notifications"),
    notifications || t(config, "reminder_detail_none"),
  ].join("\n");
}

export async function handleReminderCallback(config: AppConfig, ctx: Context): Promise<boolean> {
  const callback = ctx.callbackQuery;
  const data = callback?.data || "";
  if (!data.startsWith(REMINDER_CALLBACK_PREFIX)) return false;
  const rest = data.slice(REMINDER_CALLBACK_PREFIX.length);
  if (!ctx.chat || !callback?.message?.message_id) return true;
  const messageId = callback.message.message_id;
  const events = await readReminderEvents(config);

  if (rest === "menu:root") {
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_menu_title"), { reply_markup: buildMenuKeyboard(config, events) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest === "menu:special") {
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, [
      t(config, "reminder_menu_special"),
      t(config, "reminder_special_summary", {
        birthday: filterEvents(events, "special:birthday").length,
        festival: filterEvents(events, "special:festival").length,
        anniversary: filterEvents(events, "special:anniversary").length,
        memorial: filterEvents(events, "special:memorial").length,
      }),
    ].join("\n"), { reply_markup: buildSpecialMenuKeyboard(config, events) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("menu:")) {
    const view = rest.slice(5) as ReminderView;
    const filtered = filterEvents(events, view);
    if (filtered.length === 0) {
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_none"), { reply_markup: view.startsWith("special") ? buildSpecialMenuKeyboard(config, events) : buildMenuKeyboard(config, events) });
    } else {
      const title = view === "upcoming"
        ? [
            t(config, "reminder_list_title", { count: filtered.length }),
            t(config, "reminder_upcoming_summary", { days: UPCOMING_WINDOW_DAYS, count: filtered.length }),
          ].join("\n")
        : t(config, "reminder_list_title", { count: filtered.length });
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, title, { reply_markup: buildListKeyboard(config, filtered, 0, view) });
    }
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("page:")) {
    const [, viewRaw, pageRaw] = rest.split(":", 3);
    const view = (viewRaw || "all") as ReminderView;
    const filtered = filterEvents(events, view);
    const title = view === "upcoming"
      ? [
          t(config, "reminder_list_title", { count: filtered.length }),
          t(config, "reminder_upcoming_summary", { days: UPCOMING_WINDOW_DAYS, count: filtered.length }),
        ].join("\n")
      : t(config, "reminder_list_title", { count: filtered.length });
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, title, { reply_markup: buildListKeyboard(config, filtered, Number(pageRaw || 0), view) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("view:")) {
    const [, viewRaw, eventId] = rest.split(":", 3);
    const view = (viewRaw || "all") as ReminderView;
    const event = await getReminderEvent(config, eventId);
    if (!event || event.status === "deleted") {
      await ctx.answerCallbackQuery({ text: t(config, "reminder_missing"), show_alert: true });
      return true;
    }
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, eventDetailText(config, event), { reply_markup: buildDetailKeyboard(config, event.id, view) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("delete:")) {
    const [, viewRaw, eventId] = rest.split(":", 3);
    const view = (viewRaw || "all") as ReminderView;
    const event = await getReminderEvent(config, eventId);
    if (!event || event.status === "deleted") {
      await ctx.answerCallbackQuery({ text: t(config, "reminder_missing"), show_alert: true });
      return true;
    }
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, `${t(config, "reminder_delete_confirm", { time: reminderEventScheduleSummary(config, event), repeat: timeSemanticsLabel(config, event), text: event.title })}\n\n${eventDetailText(config, event)}`, { reply_markup: buildDeleteConfirmKeyboard(config, event.id, view) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("confirm-delete:")) {
    const [, viewRaw, eventId] = rest.split(":", 3);
    const view = (viewRaw || "all") as ReminderView;
    await deleteReminderEvent(config, eventId);
    const refreshed = await readReminderEvents(config);
    const next = filterEvents(refreshed, view);
    if (next.length === 0) {
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_none"), { reply_markup: view.startsWith("special") ? buildSpecialMenuKeyboard(config, refreshed) : buildMenuKeyboard(config, refreshed) });
    } else {
      const title = view === "upcoming"
        ? [
            t(config, "reminder_list_title", { count: next.length }),
            t(config, "reminder_upcoming_summary", { days: UPCOMING_WINDOW_DAYS, count: next.length }),
          ].join("\n")
        : t(config, "reminder_list_title", { count: next.length });
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, title, { reply_markup: buildListKeyboard(config, next, 0, view) });
    }
    await ctx.answerCallbackQuery({ text: t(config, "reminder_deleted") });
    return true;
  }

  await ctx.answerCallbackQuery();
  return true;
}
