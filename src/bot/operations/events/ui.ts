import { InlineKeyboard, type Context } from "grammy";
import type { AppConfig } from "bot/app/types";
import { tForLocale, userLocale, type Locale } from "bot/app/i18n";
import { resolveChatDisplayName, resolveUserDisplayName } from "bot/operations/context/store";
import { editMessageTextFormatted } from "bot/telegram/format";
import type { EventRecord, ReminderInstance, EventView } from "./types";
import { formatEventRecord, getCurrentOccurrence, listReminderInstances, scheduleEventScheduleSummary } from "./schedule";
import { deleteEventRecord, getEventRecord, readEventRecords } from "./store";

const SCHEDULE_CALLBACK_PREFIX = "schedule:";
const UPCOMING_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function activeEvents(events: EventRecord[]): EventRecord[] {
  return events.filter((item) => item.status === "active");
}

function filterEvents(events: EventRecord[], view: EventView): EventRecord[] {
  const schedules = activeEvents(events);
  if (view === "all") return schedules;
  if (view === "upcoming") {
    const now = Date.now();
    const end = now + UPCOMING_WINDOW_DAYS * MS_PER_DAY;
    return schedules.filter((item) => {
      const occurrence = getCurrentOccurrence(item);
      if (!occurrence) return false;
      const ts = Date.parse(occurrence.scheduledAt);
      return Number.isFinite(ts) && ts >= now && ts <= end;
    });
  }
  if (view === "routine") return schedules.filter((item) => (item.category || "routine") === "routine");
  if (view === "special") return schedules.filter((item) => item.category === "special");
  if (view === "special:birthday") return schedules.filter((item) => item.specialKind === "birthday");
  if (view === "special:festival") return schedules.filter((item) => item.specialKind === "festival");
  if (view === "special:anniversary") return schedules.filter((item) => item.specialKind === "anniversary");
  if (view === "special:memorial") return schedules.filter((item) => item.specialKind === "memorial");
  return schedules;
}

function menuLabel(locale: Locale, key: string, count: number): string {
  return `${tForLocale(locale, key)} ×${count}`;
}

function buildMenuKeyboard(_config: AppConfig, locale: Locale, events: EventRecord[]): InlineKeyboard {
  return new InlineKeyboard()
    .text(menuLabel(locale, "schedule_menu_upcoming", filterEvents(events, "upcoming").length), `${SCHEDULE_CALLBACK_PREFIX}menu:upcoming`).row()
    .text(menuLabel(locale, "schedule_menu_routine", filterEvents(events, "routine").length), `${SCHEDULE_CALLBACK_PREFIX}menu:routine`).row()
    .text(menuLabel(locale, "schedule_menu_special", filterEvents(events, "special").length), `${SCHEDULE_CALLBACK_PREFIX}menu:special`).row()
    .text(menuLabel(locale, "schedule_menu_all", filterEvents(events, "all").length), `${SCHEDULE_CALLBACK_PREFIX}menu:all`);
}

function buildSpecialMenuKeyboard(locale: Locale, events: EventRecord[]): InlineKeyboard {
  return new InlineKeyboard()
    .text(menuLabel(locale, "schedule_menu_special_birthday", filterEvents(events, "special:birthday").length), `${SCHEDULE_CALLBACK_PREFIX}menu:special:birthday`).row()
    .text(menuLabel(locale, "schedule_menu_special_festival", filterEvents(events, "special:festival").length), `${SCHEDULE_CALLBACK_PREFIX}menu:special:festival`).row()
    .text(menuLabel(locale, "schedule_menu_special_anniversary", filterEvents(events, "special:anniversary").length), `${SCHEDULE_CALLBACK_PREFIX}menu:special:anniversary`).row()
    .text(menuLabel(locale, "schedule_menu_special_memorial", filterEvents(events, "special:memorial").length), `${SCHEDULE_CALLBACK_PREFIX}menu:special:memorial`).row()
    .text(tForLocale(locale, "schedule_back"), `${SCHEDULE_CALLBACK_PREFIX}menu:root`);
}

function buildListKeyboard(config: AppConfig, locale: Locale, events: EventRecord[], page: number, view: EventView): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageSize = Math.max(1, config.telegram.menuPageSize);
  const totalPages = Math.max(1, Math.ceil(events.length / pageSize));
  const start = page * pageSize;
  const pageItems = events.slice(start, start + pageSize);
  pageItems.forEach((item) => keyboard.text(formatEventRecord(config, item, locale).slice(0, 60), `${SCHEDULE_CALLBACK_PREFIX}view:${view}:${item.id}`).row());
  if (totalPages > 1) {
    if (page > 0) keyboard.text(tForLocale(locale, "schedule_prev"), `${SCHEDULE_CALLBACK_PREFIX}page:${view}:${page - 1}`);
    if (page < totalPages - 1) keyboard.text(tForLocale(locale, "schedule_next"), `${SCHEDULE_CALLBACK_PREFIX}page:${view}:${page + 1}`);
    keyboard.row();
  }
  keyboard.text(tForLocale(locale, "schedule_back"), `${SCHEDULE_CALLBACK_PREFIX}menu:${view.startsWith("special:") ? "special" : "root"}`);
  return keyboard;
}

function buildDetailKeyboard(locale: Locale, eventId: string, view: EventView): InlineKeyboard {
  return new InlineKeyboard().text(tForLocale(locale, "schedule_delete"), `${SCHEDULE_CALLBACK_PREFIX}delete:${view}:${eventId}`).row().text(tForLocale(locale, "schedule_back"), `${SCHEDULE_CALLBACK_PREFIX}page:${view}:0`);
}

function buildDeleteConfirmKeyboard(locale: Locale, eventId: string, view: EventView): InlineKeyboard {
  return new InlineKeyboard().text(tForLocale(locale, "schedule_confirm_delete"), `${SCHEDULE_CALLBACK_PREFIX}confirm-delete:${view}:${eventId}`).text(tForLocale(locale, "schedule_cancel"), `${SCHEDULE_CALLBACK_PREFIX}view:${view}:${eventId}`);
}

function reminderLabel(instance: ReminderInstance): string {
  return instance.label || `${instance.offsetMinutes}m`;
}

function timeSemanticsLabel(locale: Locale, event: EventRecord): string {
  return tForLocale(locale, event.timeSemantics === "absolute" ? "schedule_time_semantics_absolute" : "schedule_time_semantics_local");
}

function eventRecipientsLabel(config: AppConfig, locale: Locale, event: EventRecord): string {
  if (event.targets.length === 0) return tForLocale(locale, "schedule_recipients_unspecified");
  return event.targets.map((item) => item.targetKind === "chat"
    ? resolveChatDisplayName(config.paths.repoRoot, item.targetId) || String(item.targetId)
    : resolveUserDisplayName(config.paths.repoRoot, item.targetId) || String(item.targetId)).join("、");
}

function eventDetailText(config: AppConfig, locale: Locale, event: EventRecord): string {
  const reminders = getCurrentOccurrence(event)
    ? listReminderInstances(event, getCurrentOccurrence(event)!).map((item) => `- ${reminderLabel(item)}`).join("\n")
    : event.reminders.map((item) => `- ${item.label || item.offsetMinutes}`).join("\n");
  return [
    `⏰ ${event.title}`,
    tForLocale(locale, "schedule_detail_time", { value: scheduleEventScheduleSummary(config, event, locale) }),
    tForLocale(locale, "schedule_detail_recipients", { value: eventRecipientsLabel(config, locale, event) }),
    tForLocale(locale, "schedule_detail_time_semantics", { value: timeSemanticsLabel(locale, event) }),
    tForLocale(locale, "schedule_detail_reminders"),
    reminders || tForLocale(locale, "schedule_detail_none"),
  ].join("\n");
}

export async function handleScheduleCallback(config: AppConfig, ctx: Context): Promise<boolean> {
  const callback = ctx.callbackQuery;
  const data = callback?.data || "";
  if (!data.startsWith(SCHEDULE_CALLBACK_PREFIX)) return false;
  const rest = data.slice(SCHEDULE_CALLBACK_PREFIX.length);
  if (!ctx.chat || !callback?.message?.message_id) return true;
  const locale = userLocale(config, ctx.from?.id);
  const messageId = callback.message.message_id;
  const events = await readEventRecords(config);

  if (rest === "menu:root") {
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, tForLocale(locale, "schedule_menu_title"), { reply_markup: buildMenuKeyboard(config, locale, events) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest === "menu:special") {
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, [
      tForLocale(locale, "schedule_menu_special"),
      tForLocale(locale, "schedule_special_summary", {
        birthday: filterEvents(events, "special:birthday").length,
        festival: filterEvents(events, "special:festival").length,
        anniversary: filterEvents(events, "special:anniversary").length,
        memorial: filterEvents(events, "special:memorial").length,
      }),
    ].join("\n"), { reply_markup: buildSpecialMenuKeyboard(locale, events) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("menu:")) {
    const view = rest.slice(5) as EventView;
    const filtered = filterEvents(events, view);
    if (filtered.length === 0) {
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, tForLocale(locale, "schedule_none"), { reply_markup: view.startsWith("special") ? buildSpecialMenuKeyboard(locale, events) : buildMenuKeyboard(config, locale, events) });
    } else {
      const title = view === "upcoming"
        ? [
            tForLocale(locale, "schedule_list_title", { count: filtered.length }),
            tForLocale(locale, "schedule_upcoming_summary", { days: UPCOMING_WINDOW_DAYS, count: filtered.length }),
          ].join("\n")
        : tForLocale(locale, "schedule_list_title", { count: filtered.length });
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, title, { reply_markup: buildListKeyboard(config, locale, filtered, 0, view) });
    }
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("page:")) {
    const [, viewRaw, pageRaw] = rest.split(":", 3);
    const view = (viewRaw || "all") as EventView;
    const filtered = filterEvents(events, view);
    const title = view === "upcoming"
      ? [
          tForLocale(locale, "schedule_list_title", { count: filtered.length }),
          tForLocale(locale, "schedule_upcoming_summary", { days: UPCOMING_WINDOW_DAYS, count: filtered.length }),
        ].join("\n")
      : tForLocale(locale, "schedule_list_title", { count: filtered.length });
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, title, { reply_markup: buildListKeyboard(config, locale, filtered, Number(pageRaw || 0), view) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("view:")) {
    const [, viewRaw, eventId] = rest.split(":", 3);
    const view = (viewRaw || "all") as EventView;
    const event = await getEventRecord(config, eventId);
    if (!event || event.status === "deleted") {
      await ctx.answerCallbackQuery({ text: tForLocale(locale, "schedule_missing"), show_alert: true });
      return true;
    }
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, eventDetailText(config, locale, event), { reply_markup: buildDetailKeyboard(locale, event.id, view) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("delete:")) {
    const [, viewRaw, eventId] = rest.split(":", 3);
    const view = (viewRaw || "all") as EventView;
    const event = await getEventRecord(config, eventId);
    if (!event || event.status === "deleted") {
      await ctx.answerCallbackQuery({ text: tForLocale(locale, "schedule_missing"), show_alert: true });
      return true;
    }
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, `${tForLocale(locale, "schedule_delete_confirm", { time: scheduleEventScheduleSummary(config, event, locale), repeat: timeSemanticsLabel(locale, event), text: event.title })}\n\n${eventDetailText(config, locale, event)}`, { reply_markup: buildDeleteConfirmKeyboard(locale, event.id, view) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("confirm-delete:")) {
    const [, viewRaw, eventId] = rest.split(":", 3);
    const view = (viewRaw || "all") as EventView;
    await deleteEventRecord(config, eventId);
    const refreshed = await readEventRecords(config);
    const next = filterEvents(refreshed, view);
    if (next.length === 0) {
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, tForLocale(locale, "schedule_none"), { reply_markup: view.startsWith("special") ? buildSpecialMenuKeyboard(locale, refreshed) : buildMenuKeyboard(config, locale, refreshed) });
    } else {
      const title = view === "upcoming"
        ? [
            tForLocale(locale, "schedule_list_title", { count: next.length }),
            tForLocale(locale, "schedule_upcoming_summary", { days: UPCOMING_WINDOW_DAYS, count: next.length }),
          ].join("\n")
        : tForLocale(locale, "schedule_list_title", { count: next.length });
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, title, { reply_markup: buildListKeyboard(config, locale, next, 0, view) });
    }
    await ctx.answerCallbackQuery({ text: tForLocale(locale, "schedule_deleted") });
    return true;
  }

  await ctx.answerCallbackQuery();
  return true;
}
