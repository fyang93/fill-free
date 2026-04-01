import type { Context } from "grammy";
import { t } from "./i18n";
import { logger } from "./logger";
import type { PromptReminderDraft } from "./opencode/types";
import type { OpenCodeService } from "./opencode";
import { persistState, rememberUserTimezone } from "./state";
import { createReminderEventWithDefaults, isValidReminderTimezone, normalizeRecurrence, normalizeScheduledAt, prepareReminderDeliveryText, reminderEventScheduleSummary, resolveReminderTimezone, updateReminderEvent, type ReminderNotification, type ReminderSchedule } from "./reminders";
import type { AppConfig } from "./types";
import { resolveReminderTargetUser, type ReminderTargetResolution } from "./telegram_identity";

function buildReminderSchedule(raw: Record<string, unknown>): ReminderSchedule {
  const kind = typeof raw.kind === "string" ? raw.kind : "once";
  if (kind === "once") return { kind: "once", scheduledAt: normalizeScheduledAt(String(raw.scheduledAt || "")) };
  if (kind === "interval") {
    const recurrence = normalizeRecurrence(raw);
    if (recurrence.kind !== "interval") throw new Error("Invalid interval reminder schedule");
    return { kind: "interval", unit: recurrence.unit, every: recurrence.every, anchorAt: normalizeScheduledAt(String(raw.anchorAt || raw.scheduledAt || "")) };
  }
  if (kind === "weekly") {
    const recurrence = normalizeRecurrence(raw);
    const time = raw.time && typeof raw.time === "object" ? raw.time as Record<string, unknown> : {};
    if (recurrence.kind !== "weekly") throw new Error("Invalid weekly reminder schedule");
    return { kind: "weekly", every: recurrence.every, daysOfWeek: recurrence.daysOfWeek, time: { hour: Number(time.hour), minute: Number(time.minute) }, anchorDate: typeof raw.anchorDate === "string" ? raw.anchorDate : undefined };
  }
  if (kind === "monthly") {
    const recurrence = normalizeRecurrence(raw);
    const time = raw.time && typeof raw.time === "object" ? raw.time as Record<string, unknown> : {};
    if (recurrence.kind !== "monthly") throw new Error("Invalid monthly reminder schedule");
    if (recurrence.mode === "dayOfMonth") return { kind: "monthly", every: recurrence.every, mode: recurrence.mode, dayOfMonth: recurrence.dayOfMonth, time: { hour: Number(time.hour), minute: Number(time.minute) }, anchorDate: typeof raw.anchorDate === "string" ? raw.anchorDate : undefined };
    return { kind: "monthly", every: recurrence.every, mode: recurrence.mode, weekOfMonth: recurrence.weekOfMonth, dayOfWeek: recurrence.dayOfWeek, time: { hour: Number(time.hour), minute: Number(time.minute) }, anchorDate: typeof raw.anchorDate === "string" ? raw.anchorDate : undefined };
  }
  if (kind === "yearly") {
    const recurrence = normalizeRecurrence(raw);
    const time = raw.time && typeof raw.time === "object" ? raw.time as Record<string, unknown> : {};
    if (recurrence.kind !== "yearly") throw new Error("Invalid yearly reminder schedule");
    return { kind: "yearly", every: recurrence.every, month: recurrence.month, day: recurrence.day, time: { hour: Number(time.hour), minute: Number(time.minute) } };
  }
  if (kind === "lunarYearly") {
    const recurrence = normalizeRecurrence(raw);
    const time = raw.time && typeof raw.time === "object" ? raw.time as Record<string, unknown> : {};
    if (recurrence.kind !== "lunarYearly") throw new Error("Invalid lunar reminder schedule");
    return { kind: "lunarYearly", month: recurrence.month, day: recurrence.day, isLeapMonth: recurrence.isLeapMonth, leapMonthPolicy: recurrence.leapMonthPolicy, time: { hour: Number(time.hour), minute: Number(time.minute) } };
  }
  throw new Error(`Unsupported reminder schedule kind: ${kind}`);
}

function buildReminderNotifications(raw: unknown): ReminderNotification[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const notifications: ReminderNotification[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const offsetMinutes = Number(record.offsetMinutes);
    if (!Number.isInteger(offsetMinutes)) return;
    notifications.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `n${index + 1}`,
      offsetMinutes,
      enabled: record.enabled !== false,
      label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined,
    });
  });
  return notifications.length > 0 ? notifications : undefined;
}

function reminderCreatedMessage(config: AppConfig, eventTitle: string, schedule: string, requesterUserId: number | undefined, target: ReminderTargetResolution): string {
  if (!target.userId || target.userId === requesterUserId) {
    return t(config, "reminder_created", { schedule, text: eventTitle });
  }
  return t(config, "reminder_created_for", {
    schedule,
    recipient: target.displayName || String(target.userId),
    text: eventTitle,
  });
}

export async function createStructuredReminders(
  config: AppConfig,
  opencode: OpenCodeService,
  rawReminders: PromptReminderDraft[],
  ctx: Context,
  userId?: number,
  telegramMessageTime?: string,
): Promise<{ created: string[]; clarifications: string[] }> {
  const created: string[] = [];
  const clarifications: string[] = [];
  let timezoneChanged = false;

  for (const raw of rawReminders) {
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const scheduleRaw = raw.schedule;
    if (!title || !scheduleRaw || typeof scheduleRaw !== "object") continue;
    const explicitTimezone = typeof raw.timezone === "string" && raw.timezone.trim() ? raw.timezone.trim() : undefined;
    const timeSemantics = raw.timeSemantics === "absolute" || raw.timeSemantics === "local" ? raw.timeSemantics : undefined;
    const target = resolveReminderTargetUser(config, raw.targetUser, ctx, userId);
    if (target.status === "ambiguous" || target.status === "not_found") {
      if (target.question) clarifications.push(target.question);
      continue;
    }

    const event = await createReminderEventWithDefaults(config, {
      title,
      note: typeof raw.note === "string" ? raw.note.trim() || undefined : undefined,
      schedule: buildReminderSchedule(scheduleRaw),
      category: raw.category === "special" ? "special" : raw.category === "routine" ? "routine" : undefined,
      specialKind: raw.specialKind === "birthday" || raw.specialKind === "festival" || raw.specialKind === "anniversary" || raw.specialKind === "memorial" ? raw.specialKind : undefined,
      kind: raw.kind === "routine" || raw.kind === "meeting" || raw.kind === "birthday" || raw.kind === "anniversary" || raw.kind === "festival" || raw.kind === "memorial" || raw.kind === "task" || raw.kind === "custom" ? raw.kind : undefined,
      timeSemantics,
      timezone: resolveReminderTimezone(config, { explicitTimezone, telegramMessageTime, timeSemantics, userId }),
      ownerUserId: userId,
      targetUserId: target.status === "self" ? undefined : target.userId,
      targetDisplayName: target.status === "self" ? undefined : target.displayName,
      notifications: buildReminderNotifications(raw.notifications),
    });
    try {
      if (await prepareReminderDeliveryText(config, opencode, event)) {
        await updateReminderEvent(config, event);
      }
    } catch (error) {
      await logger.warn(`failed to pre-generate reminder message for ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (explicitTimezone && isValidReminderTimezone(explicitTimezone)) {
      rememberUserTimezone(userId, explicitTimezone);
      timezoneChanged = true;
    }
    created.push(reminderCreatedMessage(config, event.title, reminderEventScheduleSummary(config, event), userId, target));
  }

  if (timezoneChanged) {
    await persistState(config.paths.stateFile);
  }
  return { created, clarifications };
}
