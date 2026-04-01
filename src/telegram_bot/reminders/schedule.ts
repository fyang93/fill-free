import solarLunar from "solarlunar";
import type { AppConfig } from "../types";
import { t, uiLocaleTag } from "../i18n";
import type {
  Reminder,
  ReminderEvent,
  ReminderNotificationInstance,
  ReminderOccurrence,
  ReminderRecurrence,
  ReminderSchedule,
} from "./types";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function clampPositiveInteger(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueSortedDays(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)))
    .sort((a, b) => a - b);
}

function monthDay(year: number, monthIndex: number, requestedDay: number): number {
  return Math.min(requestedDay, new Date(year, monthIndex + 1, 0).getDate());
}

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

function addMonths(base: Date, amount: number): Date {
  const next = cloneDate(base);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + amount);
  next.setDate(monthDay(next.getFullYear(), next.getMonth(), originalDay));
  return next;
}

function addYears(base: Date, amount: number): Date {
  const next = cloneDate(base);
  const month = next.getMonth();
  const day = next.getDate();
  next.setDate(1);
  next.setFullYear(next.getFullYear() + amount);
  next.setMonth(month);
  next.setDate(monthDay(next.getFullYear(), month, day));
  return next;
}

function startOfWeek(date: Date): Date {
  const next = cloneDate(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function weeksBetween(a: Date, b: Date): number {
  const diff = startOfWeek(b).getTime() - startOfWeek(a).getTime();
  return Math.floor(diff / (7 * MS_PER_DAY));
}

function nthWeekdayOfMonth(year: number, monthIndex: number, weekOfMonth: number, dayOfWeek: number, hour: number, minute: number): Date | null {
  if (weekOfMonth === -1) {
    const lastDay = new Date(year, monthIndex + 1, 0);
    const offset = (lastDay.getDay() - dayOfWeek + 7) % 7;
    const candidate = new Date(year, monthIndex, lastDay.getDate() - offset, hour, minute, 0, 0);
    return candidate.getMonth() === monthIndex ? candidate : null;
  }
  const firstDay = new Date(year, monthIndex, 1);
  const offset = (dayOfWeek - firstDay.getDay() + 7) % 7;
  const day = 1 + offset + (weekOfMonth - 1) * 7;
  const candidate = new Date(year, monthIndex, day, hour, minute, 0, 0);
  return candidate.getMonth() === monthIndex ? candidate : null;
}

function lunarMonthLabel(month: number, isLeapMonth = false): string {
  return `${isLeapMonth ? "闰" : ""}${solarLunar.toChinaMonth(month)}`;
}

function lunarDayLabel(day: number): string {
  return solarLunar.toChinaDay(day);
}

function eventTime(schedule: ReminderSchedule): { hour: number; minute: number } {
  if (schedule.kind === "once") {
    const date = new Date(schedule.scheduledAt);
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
  if (schedule.kind === "interval") {
    const date = new Date(schedule.anchorAt);
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
  return schedule.time;
}

export function normalizeScheduledAt(input: string): string {
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid reminder time: ${input}`);
  }
  return new Date(parsed).toISOString();
}

export function normalizeRecurrence(input: unknown): ReminderRecurrence {
  if (!input || typeof input !== "object") {
    return { kind: "once" };
  }
  const record = input as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : "once";

  if (kind === "daily") return { kind: "interval", unit: "day", every: 1 };
  if (kind === "weekdays") return { kind: "weekly", every: 1, daysOfWeek: [1, 2, 3, 4, 5] };
  if (kind === "once") return { kind: "once" };

  if (kind === "interval") {
    const unit = record.unit;
    if (unit === "minute" || unit === "hour" || unit === "day" || unit === "week" || unit === "month" || unit === "year") {
      return { kind: "interval", unit, every: clampPositiveInteger(record.every, 1) };
    }
    return { kind: "once" };
  }

  if (kind === "weekly") {
    const daysOfWeek = uniqueSortedDays(record.daysOfWeek);
    if (daysOfWeek.length > 0) {
      return { kind: "weekly", every: clampPositiveInteger(record.every, 1), daysOfWeek };
    }
    return { kind: "once" };
  }

  if (kind === "monthly") {
    const every = clampPositiveInteger(record.every, 1);
    const mode = record.mode;
    if (mode === "nthWeekday") {
      const weekOfMonth = Number(record.weekOfMonth);
      const dayOfWeek = Number(record.dayOfWeek);
      if (Number.isInteger(weekOfMonth) && weekOfMonth >= -1 && weekOfMonth <= 5 && weekOfMonth !== 0 && Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6) {
        return { kind: "monthly", every, mode: "nthWeekday", weekOfMonth, dayOfWeek };
      }
      return { kind: "once" };
    }
    const dayOfMonth = Number(record.dayOfMonth);
    if (Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31) {
      return { kind: "monthly", every, mode: "dayOfMonth", dayOfMonth };
    }
    return { kind: "once" };
  }

  if (kind === "yearly") {
    const month = Number(record.month);
    const day = Number(record.day);
    if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31) {
      return { kind: "yearly", every: clampPositiveInteger(record.every, 1), month, day, offsetDays: Number.isInteger(Number(record.offsetDays)) ? Number(record.offsetDays) : 0 };
    }
  }

  if (kind === "lunarYearly") {
    const month = Number(record.month);
    const day = Number(record.day);
    const isLeapMonth = record.isLeapMonth === true;
    const leapMonthPolicy = record.leapMonthPolicy === "same-leap-only" || record.leapMonthPolicy === "both" ? record.leapMonthPolicy : "prefer-non-leap";
    if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 30) {
      return { kind: "lunarYearly", month, day, isLeapMonth, leapMonthPolicy, offsetDays: Number.isInteger(Number(record.offsetDays)) ? Number(record.offsetDays) : 0 };
    }
  }

  return { kind: "once" };
}

export function nextLunarYearlyOccurrence(baseIso: string, now: Date, recurrence: Extract<ReminderRecurrence, { kind: "lunarYearly" }>): string {
  const base = new Date(baseIso);
  if (!Number.isFinite(base.getTime())) throw new Error(`Invalid reminder time: ${baseIso}`);
  const nowLunar = solarLunar.solar2lunar(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (nowLunar === -1) throw new Error(`Failed to convert current date to lunar date: ${now.toISOString()}`);
  const offsetDays = recurrence.offsetDays || 0;
  for (let lunarYear = nowLunar.lYear; lunarYear <= nowLunar.lYear + 120; lunarYear += 1) {
    const leapMonth = solarLunar.leapMonth(lunarYear);
    const variants: boolean[] = [];
    if (!recurrence.isLeapMonth) {
      variants.push(false);
    } else if ((recurrence.leapMonthPolicy || "prefer-non-leap") === "same-leap-only") {
      if (leapMonth === recurrence.month) variants.push(true);
    } else if ((recurrence.leapMonthPolicy || "prefer-non-leap") === "both") {
      variants.push(false);
      if (leapMonth === recurrence.month) variants.push(true);
    } else {
      variants.push(false);
    }

    for (const isLeapMonth of Array.from(new Set(variants))) {
      const converted = solarLunar.lunar2solar(lunarYear, recurrence.month, recurrence.day, isLeapMonth);
      if (converted === -1) continue;
      const actualEvent = new Date(converted.cYear, converted.cMonth - 1, converted.cDay, base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
      const candidate = new Date(actualEvent.getTime() + offsetDays * MS_PER_DAY);
      if (candidate.getTime() <= now.getTime()) continue;
      return candidate.toISOString();
    }
  }
  throw new Error(`Failed to compute next lunar reminder from ${baseIso}`);
}

function nextWeeklyEventOccurrence(schedule: Extract<ReminderSchedule, { kind: "weekly" }>, reference: Date): string {
  const start = cloneDate(reference);
  const anchor = schedule.anchorDate ? new Date(schedule.anchorDate) : start;
  for (let offset = 0; offset <= 366 * Math.max(1, schedule.every); offset += 1) {
    const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, schedule.time.hour, schedule.time.minute, 0, 0);
    if (candidate.getTime() < reference.getTime()) continue;
    if (!schedule.daysOfWeek.includes(candidate.getDay())) continue;
    const passedWeeks = weeksBetween(anchor, candidate);
    if (passedWeeks % schedule.every !== 0) continue;
    return candidate.toISOString();
  }
  throw new Error("Failed to compute next weekly event occurrence");
}

function nextMonthlyEventOccurrence(schedule: Extract<ReminderSchedule, { kind: "monthly" }>, reference: Date): string {
  const startYear = reference.getFullYear();
  const startMonth = reference.getMonth();
  for (let monthOffset = 0; monthOffset <= schedule.every * 120; monthOffset += 1) {
    const year = startYear + Math.floor((startMonth + monthOffset) / 12);
    const monthIndex = (startMonth + monthOffset) % 12;
    let candidate: Date | null;
    if (schedule.mode === "dayOfMonth") {
      candidate = new Date(year, monthIndex, monthDay(year, monthIndex, schedule.dayOfMonth), schedule.time.hour, schedule.time.minute, 0, 0);
    } else {
      candidate = nthWeekdayOfMonth(year, monthIndex, schedule.weekOfMonth, schedule.dayOfWeek, schedule.time.hour, schedule.time.minute);
    }
    if (!candidate || candidate.getTime() < reference.getTime()) continue;
    return candidate.toISOString();
  }
  throw new Error("Failed to compute next monthly event occurrence");
}

function nextYearlyEventOccurrence(schedule: Extract<ReminderSchedule, { kind: "yearly" }>, reference: Date): string {
  for (let year = reference.getFullYear(); year <= reference.getFullYear() + schedule.every * 100; year += 1) {
    const candidate = new Date(year, schedule.month - 1, monthDay(year, schedule.month - 1, schedule.day), schedule.time.hour, schedule.time.minute, 0, 0);
    if (candidate.getTime() < reference.getTime()) continue;
    return candidate.toISOString();
  }
  throw new Error("Failed to compute next yearly event occurrence");
}

function nextLunarEventOccurrence(schedule: Extract<ReminderSchedule, { kind: "lunarYearly" }>, reference: Date): string {
  const base = new Date(reference);
  base.setHours(schedule.time.hour, schedule.time.minute, 0, 0);
  return nextLunarYearlyOccurrence(base.toISOString(), new Date(reference.getTime() - 1000), {
    kind: "lunarYearly",
    month: schedule.month,
    day: schedule.day,
    isLeapMonth: schedule.isLeapMonth,
    leapMonthPolicy: schedule.leapMonthPolicy,
  });
}

function nextIntervalEventOccurrence(schedule: Extract<ReminderSchedule, { kind: "interval" }>, reference: Date): string {
  let candidate = new Date(schedule.anchorAt);
  if (!Number.isFinite(candidate.getTime())) throw new Error(`Invalid reminder time: ${schedule.anchorAt}`);
  while (candidate.getTime() < reference.getTime()) {
    if (schedule.unit === "minute") candidate = new Date(candidate.getTime() + schedule.every * MS_PER_MINUTE);
    else if (schedule.unit === "hour") candidate = new Date(candidate.getTime() + schedule.every * MS_PER_HOUR);
    else if (schedule.unit === "day") candidate = new Date(candidate.getTime() + schedule.every * MS_PER_DAY);
    else if (schedule.unit === "week") candidate = new Date(candidate.getTime() + schedule.every * 7 * MS_PER_DAY);
    else if (schedule.unit === "month") candidate = addMonths(candidate, schedule.every);
    else candidate = addYears(candidate, schedule.every);
  }
  return candidate.toISOString();
}

export function nextScheduleOccurrence(schedule: ReminderSchedule, reference = new Date()): string | null {
  if (schedule.kind === "once") {
    return schedule.scheduledAt;
  }
  if (schedule.kind === "interval") return nextIntervalEventOccurrence(schedule, reference);
  if (schedule.kind === "weekly") return nextWeeklyEventOccurrence(schedule, reference);
  if (schedule.kind === "monthly") return nextMonthlyEventOccurrence(schedule, reference);
  if (schedule.kind === "yearly") return nextYearlyEventOccurrence(schedule, reference);
  return nextLunarEventOccurrence(schedule, reference);
}

export function getCurrentOccurrence(event: ReminderEvent, now = new Date()): ReminderOccurrence | null {
  const existing = event.deliveryState?.currentOccurrence?.scheduledAt;
  if (existing) return { scheduledAt: existing };
  const scheduledAt = nextScheduleOccurrence(event.schedule, now);
  return scheduledAt ? { scheduledAt } : null;
}

export function listNotificationInstances(event: ReminderEvent, occurrence: ReminderOccurrence): ReminderNotificationInstance[] {
  return event.notifications
    .filter((item) => item.enabled)
    .map((notification) => ({
      notificationId: notification.id,
      offsetMinutes: notification.offsetMinutes,
      notifyAt: new Date(new Date(occurrence.scheduledAt).getTime() + notification.offsetMinutes * MS_PER_MINUTE).toISOString(),
      label: notification.label,
    }))
    .sort((a, b) => a.notifyAt.localeCompare(b.notifyAt));
}

export function allNotificationsSent(event: ReminderEvent): boolean {
  const current = event.deliveryState?.currentOccurrence;
  if (!current) return false;
  const enabledIds = event.notifications.filter((item) => item.enabled).map((item) => item.id).sort();
  const sentIds = Array.from(new Set(current.sentNotificationIds)).sort();
  return enabledIds.length > 0 && enabledIds.every((id, index) => sentIds[index] === id);
}

function reminderTimeLabel(schedule: ReminderSchedule): string {
  const time = eventTime(schedule);
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function offsetSuffix(config: AppConfig, offsetDays = 0): string {
  if (offsetDays === 0) return "";
  return t(config, "reminder_offset_days_before", { days: Math.abs(offsetDays) });
}

export function reminderEventScheduleSummary(config: AppConfig, event: ReminderEvent): string {
  const schedule = event.schedule;
  if (schedule.kind === "once") {
    return new Date(schedule.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false });
  }
  if (schedule.kind === "interval") {
    if (schedule.unit === "day" && schedule.every === 1) return t(config, "reminder_created_daily", { time: reminderTimeLabel(schedule) });
    return t(config, "reminder_created_interval", { every: schedule.every, unit: t(config, `reminder_unit_${schedule.unit}`), time: reminderTimeLabel(schedule) });
  }
  if (schedule.kind === "weekly") {
    if (schedule.every === 1 && schedule.daysOfWeek.join(",") === "1,2,3,4,5") return t(config, "reminder_created_weekdays", { time: reminderTimeLabel(schedule) });
    return t(config, "reminder_created_weekly", {
      every: schedule.every,
      days: schedule.daysOfWeek.map((day) => t(config, `weekday_short_${day}`)).join(", "),
      time: reminderTimeLabel(schedule),
    });
  }
  if (schedule.kind === "monthly") {
    if (schedule.mode === "dayOfMonth") {
      return t(config, "reminder_created_monthly_day", { every: schedule.every, day: schedule.dayOfMonth, time: reminderTimeLabel(schedule) });
    }
    return t(config, "reminder_created_monthly_nth_weekday", {
      every: schedule.every,
      ordinal: t(config, `ordinal_${schedule.weekOfMonth}`),
      day: t(config, `weekday_short_${schedule.dayOfWeek}`),
      time: reminderTimeLabel(schedule),
    });
  }
  if (schedule.kind === "yearly") {
    return t(config, "reminder_created_yearly", {
      every: schedule.every,
      month: schedule.month,
      day: schedule.day,
      offset: "",
      time: reminderTimeLabel(schedule),
    }).trim();
  }
  return t(config, "reminder_created_lunar_yearly", {
    month: lunarMonthLabel(schedule.month, schedule.isLeapMonth),
    day: lunarDayLabel(schedule.day),
    leapPolicy: schedule.isLeapMonth ? t(config, `reminder_lunar_leap_policy_${schedule.leapMonthPolicy || "prefer-non-leap"}`) : "",
    offset: "",
    time: reminderTimeLabel(schedule),
  }).trim();
}

function notificationLabel(config: AppConfig, instance: ReminderNotificationInstance): string {
  if (instance.label) return instance.label;
  if (instance.offsetMinutes === 0) return t(config, "reminder_repeat_none");
  const abs = Math.abs(instance.offsetMinutes);
  if (abs % 1440 === 0) return t(config, "reminder_offset_days_before", { days: abs / 1440 });
  if (abs % 60 === 0) return `${abs / 60}${t(config, "reminder_unit_hour")}`;
  return `${abs}${t(config, "reminder_unit_minute")}`;
}

export function formatReminderEvent(config: AppConfig, event: ReminderEvent): string {
  const occurrence = getCurrentOccurrence(event);
  const when = occurrence
    ? new Date(occurrence.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false }).slice(0, 16)
    : reminderEventScheduleSummary(config, event);
  const notifications = occurrence
    ? listNotificationInstances(event, occurrence).map((item) => notificationLabel(config, item)).join("、")
    : event.notifications.map((item) => item.label || String(item.offsetMinutes)).join("、");
  return `${when} ${event.title}${notifications ? ` [${notifications}]` : ""}`;
}

// Legacy wrappers kept temporarily while parts of the system still consume the old Reminder shape.
function recurrenceKind(reminder: Reminder): ReminderRecurrence["kind"] {
  return normalizeRecurrence(reminder.recurrence).kind;
}

function isRecurring(reminder: Reminder): boolean {
  return recurrenceKind(reminder) !== "once";
}

function nextWeeklyOccurrence(baseIso: string, now: Date, recurrence: Extract<ReminderRecurrence, { kind: "weekly" }>): string {
  const base = new Date(baseIso);
  if (!Number.isFinite(base.getTime())) throw new Error(`Invalid reminder time: ${baseIso}`);
  const allowedDays = new Set(recurrence.daysOfWeek);
  for (let offset = 1; offset <= 366 * Math.max(1, recurrence.every); offset += 1) {
    const candidate = cloneDate(base);
    candidate.setDate(candidate.getDate() + offset);
    if (!allowedDays.has(candidate.getDay())) continue;
    const passedWeeks = weeksBetween(base, candidate);
    if (passedWeeks % recurrence.every !== 0) continue;
    if (candidate.getTime() <= now.getTime()) continue;
    return candidate.toISOString();
  }
  throw new Error(`Failed to compute next weekly reminder from ${baseIso}`);
}

function nextMonthlyOccurrence(baseIso: string, now: Date, recurrence: Extract<ReminderRecurrence, { kind: "monthly" }>): string {
  const base = new Date(baseIso);
  if (!Number.isFinite(base.getTime())) throw new Error(`Invalid reminder time: ${baseIso}`);
  for (let monthOffset = recurrence.every; monthOffset <= recurrence.every * 120; monthOffset += recurrence.every) {
    const target = addMonths(base, monthOffset);
    let candidate: Date | null;
    if (recurrence.mode === "dayOfMonth") {
      candidate = new Date(target.getFullYear(), target.getMonth(), monthDay(target.getFullYear(), target.getMonth(), recurrence.dayOfMonth), base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
    } else {
      candidate = nthWeekdayOfMonth(target.getFullYear(), target.getMonth(), recurrence.weekOfMonth, recurrence.dayOfWeek, base.getHours(), base.getMinutes());
    }
    if (!candidate) continue;
    if (candidate.getTime() <= now.getTime()) continue;
    return candidate.toISOString();
  }
  throw new Error(`Failed to compute next monthly reminder from ${baseIso}`);
}

function nextYearlyOccurrence(baseIso: string, now: Date, recurrence: Extract<ReminderRecurrence, { kind: "yearly" }>): string {
  const base = new Date(baseIso);
  if (!Number.isFinite(base.getTime())) throw new Error(`Invalid reminder time: ${baseIso}`);
  const offsetDays = recurrence.offsetDays || 0;
  for (let yearOffset = 0; yearOffset <= recurrence.every * 100; yearOffset += recurrence.every) {
    const year = base.getFullYear() + yearOffset;
    const actualEvent = new Date(year, recurrence.month - 1, monthDay(year, recurrence.month - 1, recurrence.day), base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
    const candidate = new Date(actualEvent.getTime() + offsetDays * MS_PER_DAY);
    if (candidate.getTime() <= now.getTime()) continue;
    return candidate.toISOString();
  }
  throw new Error(`Failed to compute next yearly reminder from ${baseIso}`);
}

export function nextReminderOccurrence(reminder: Reminder, now = new Date()): string | null {
  const recurrence = normalizeRecurrence(reminder.recurrence);
  if (recurrence.kind === "once") return null;
  if ((recurrence.kind === "yearly" || recurrence.kind === "lunarYearly") && !reminder.specialKind) {
    return null;
  }
  if (recurrence.kind === "interval") {
    const schedule: ReminderSchedule = { kind: "interval", unit: recurrence.unit, every: recurrence.every, anchorAt: reminder.scheduledAt };
    return nextScheduleOccurrence(schedule, now);
  }
  if (recurrence.kind === "weekly") return nextWeeklyOccurrence(reminder.scheduledAt, now, recurrence);
  if (recurrence.kind === "monthly") return nextMonthlyOccurrence(reminder.scheduledAt, now, recurrence);
  if (recurrence.kind === "yearly") return nextYearlyOccurrence(reminder.scheduledAt, now, recurrence);
  return nextLunarYearlyOccurrence(reminder.scheduledAt, now, recurrence);
}

export function reminderRecurrenceText(config: AppConfig, reminder: Reminder): string {
  const recurrence = normalizeRecurrence(reminder.recurrence);
  if (recurrence.kind === "interval") {
    if (recurrence.unit === "day" && recurrence.every === 1) return t(config, "reminder_repeat_daily");
    return t(config, "reminder_repeat_interval", { every: recurrence.every, unit: t(config, `reminder_unit_${recurrence.unit}`) });
  }
  if (recurrence.kind === "weekly") {
    if (recurrence.every === 1 && recurrence.daysOfWeek.join(",") === "1,2,3,4,5") return t(config, "reminder_repeat_weekdays");
    return t(config, "reminder_repeat_weekly", { every: recurrence.every, days: recurrence.daysOfWeek.map((day) => t(config, `weekday_short_${day}`)).join(", ") });
  }
  if (recurrence.kind === "monthly") {
    if (recurrence.mode === "dayOfMonth") return t(config, "reminder_repeat_monthly_day", { every: recurrence.every, day: recurrence.dayOfMonth });
    return t(config, "reminder_repeat_monthly_nth_weekday", { every: recurrence.every, ordinal: t(config, `ordinal_${recurrence.weekOfMonth}`), day: t(config, `weekday_short_${recurrence.dayOfWeek}`) });
  }
  if (recurrence.kind === "yearly") {
    return t(config, "reminder_repeat_yearly", { every: recurrence.every, month: recurrence.month, day: recurrence.day, offset: offsetSuffix(config, recurrence.offsetDays) }).trim();
  }
  if (recurrence.kind === "lunarYearly") {
    return t(config, "reminder_repeat_lunar_yearly", {
      month: lunarMonthLabel(recurrence.month, recurrence.isLeapMonth),
      day: lunarDayLabel(recurrence.day),
      leapPolicy: recurrence.isLeapMonth ? t(config, `reminder_lunar_leap_policy_${recurrence.leapMonthPolicy || "prefer-non-leap"}`) : "",
      offset: offsetSuffix(config, recurrence.offsetDays),
    }).trim();
  }
  return t(config, "reminder_repeat_none");
}

export function formatReminder(config: AppConfig, reminder: Reminder): string {
  const repeatLabel = isRecurring(reminder) ? `[${reminderRecurrenceText(config, reminder)}]` : "";
  return `${new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false }).slice(0, 16)}${repeatLabel ? ` ${repeatLabel}` : ""} ${reminder.text}`;
}

export function reminderScheduleSummary(config: AppConfig, reminder: Reminder): string {
  const time = new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false });
  const recurrence = normalizeRecurrence(reminder.recurrence);
  if (recurrence.kind === "interval") {
    if (recurrence.unit === "day" && recurrence.every === 1) return t(config, "reminder_created_daily", { time });
    return t(config, "reminder_created_interval", { every: recurrence.every, unit: t(config, `reminder_unit_${recurrence.unit}`), time });
  }
  if (recurrence.kind === "weekly") {
    if (recurrence.every === 1 && recurrence.daysOfWeek.join(",") === "1,2,3,4,5") return t(config, "reminder_created_weekdays", { time });
    return t(config, "reminder_created_weekly", { every: recurrence.every, days: recurrence.daysOfWeek.map((day) => t(config, `weekday_short_${day}`)).join(", "), time });
  }
  if (recurrence.kind === "monthly") {
    if (recurrence.mode === "dayOfMonth") return t(config, "reminder_created_monthly_day", { every: recurrence.every, day: recurrence.dayOfMonth, time });
    return t(config, "reminder_created_monthly_nth_weekday", { every: recurrence.every, ordinal: t(config, `ordinal_${recurrence.weekOfMonth}`), day: t(config, `weekday_short_${recurrence.dayOfWeek}`), time });
  }
  if (recurrence.kind === "yearly") {
    return t(config, "reminder_created_yearly", { every: recurrence.every, month: recurrence.month, day: recurrence.day, offset: offsetSuffix(config, recurrence.offsetDays), time }).trim();
  }
  if (recurrence.kind === "lunarYearly") {
    return t(config, "reminder_created_lunar_yearly", {
      month: lunarMonthLabel(recurrence.month, recurrence.isLeapMonth),
      day: lunarDayLabel(recurrence.day),
      leapPolicy: recurrence.isLeapMonth ? t(config, `reminder_lunar_leap_policy_${recurrence.leapMonthPolicy || "prefer-non-leap"}`) : "",
      offset: offsetSuffix(config, recurrence.offsetDays),
      time,
    }).trim();
  }
  return t(config, "reminder_created_once", { time });
}
