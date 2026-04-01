import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import solarLunar from "solarlunar";
import type { AppConfig } from "./types";
import { logger } from "./logger";
import { t, uiLocaleTag } from "./i18n";
import { editMessageTextFormatted, replyFormatted, sendMessageFormatted } from "./telegram_format";

export type ReminderRecurrence =
  | { kind: "once" }
  | { kind: "interval"; unit: "minute" | "hour" | "day" | "week" | "month" | "year"; every: number }
  | { kind: "weekly"; every: number; daysOfWeek: number[] }
  | { kind: "monthly"; every: number; mode: "dayOfMonth"; dayOfMonth: number }
  | { kind: "monthly"; every: number; mode: "nthWeekday"; weekOfMonth: number; dayOfWeek: number }
  | { kind: "yearly"; every: number; month: number; day: number; offsetDays?: number }
  | { kind: "lunarYearly"; month: number; day: number; isLeapMonth?: boolean; leapMonthPolicy?: "same-leap-only" | "prefer-non-leap" | "both"; offsetDays?: number };

export type Reminder = {
  id: string;
  text: string;
  scheduledAt: string;
  recurrence?: ReminderRecurrence;
  repeat?: "none" | "daily";
  category?: "routine" | "special";
  specialKind?: "birthday" | "festival" | "anniversary" | "memorial";
  status: "pending" | "sent" | "deleted";
  createdAt: string;
  sentAt?: string;
};

export type AutoReminderEvent = {
  kind: "birthday" | "anniversary" | "memorial" | "festival";
  title: string;
  calendar: "gregorian" | "chinese-lunar";
  month: number;
  day: number;
  year?: number;
  isLeapMonth?: boolean;
  leapMonthPolicy?: "same-leap-only" | "prefer-non-leap" | "both";
  reminderTime?: { hour: number; minute: number };
  offsetsDays?: number[];
};

const BUILTIN_FESTIVALS: Record<string, Omit<AutoReminderEvent, "reminderTime" | "offsetsDays">> = {
  "春节": { kind: "festival", title: "春节", calendar: "chinese-lunar", month: 1, day: 1 },
  "元宵节": { kind: "festival", title: "元宵节", calendar: "chinese-lunar", month: 1, day: 15 },
  "端午节": { kind: "festival", title: "端午节", calendar: "chinese-lunar", month: 5, day: 5 },
  "中秋节": { kind: "festival", title: "中秋节", calendar: "chinese-lunar", month: 8, day: 15 },
  "重阳节": { kind: "festival", title: "重阳节", calendar: "chinese-lunar", month: 9, day: 9 },
  "清明节": { kind: "festival", title: "清明节", calendar: "gregorian", month: 4, day: 5 },
  "除夕": { kind: "festival", title: "除夕", calendar: "chinese-lunar", month: 12, day: 30 },
};

const REMINDER_CALLBACK_PREFIX = "reminder:";
type ReminderView = "menu" | "upcoming" | "routine" | "special" | "special:birthday" | "special:festival" | "special:anniversary" | "special:memorial" | "all";
const UPCOMING_WINDOW_DAYS = 30;
const WEEKDAY_SET = new Set([1, 2, 3, 4, 5]);
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function remindersPath(config: AppConfig): string {
  return path.join(config.paths.repoRoot, "index", "reminders.json");
}

function normalizeScheduledAt(input: string): string {
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid reminder time: ${input}`);
  }
  return new Date(parsed).toISOString();
}

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

function normalizeRecurrence(input: unknown, legacyRepeat?: Reminder["repeat"]): ReminderRecurrence {
  if (legacyRepeat === "daily") {
    return { kind: "interval", unit: "day", every: 1 };
  }
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

function normalizeReminder(raw: unknown): Reminder | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const text = typeof record.text === "string" ? record.text : "";
  const scheduledAt = typeof record.scheduledAt === "string" ? record.scheduledAt : "";
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  const status = record.status === "pending" || record.status === "sent" || record.status === "deleted" ? record.status : null;
  const sentAt = typeof record.sentAt === "string" ? record.sentAt : undefined;
  const category = record.category === "special" ? "special" : "routine";
  const specialKind = record.specialKind === "birthday" || record.specialKind === "festival" || record.specialKind === "anniversary" || record.specialKind === "memorial" ? record.specialKind : undefined;
  if (!id || !text || !scheduledAt || !createdAt || !status) return null;
  return {
    id,
    text,
    scheduledAt: normalizeScheduledAt(scheduledAt),
    recurrence: normalizeRecurrence(record.recurrence, record.repeat === "daily" ? "daily" : "none"),
    category,
    specialKind,
    status,
    createdAt,
    sentAt,
  };
}

async function readReminders(config: AppConfig): Promise<Reminder[]> {
  const filePath = remindersPath(config);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeReminder).filter((item): item is Reminder => Boolean(item));
  } catch {
    return [];
  }
}

async function writeReminders(config: AppConfig, reminders: Reminder[]): Promise<void> {
  const filePath = remindersPath(config);
  await mkdir(path.dirname(filePath), { recursive: true });
  const serialized = reminders.map(({ repeat: _repeat, ...item }) => ({
    ...item,
    recurrence: normalizeRecurrence(item.recurrence),
  }));
  await writeFile(filePath, JSON.stringify(serialized, null, 2), "utf8");
}

export async function createReminder(
  config: AppConfig,
  text: string,
  scheduledAt: string,
  recurrence?: unknown,
  metadata?: { category?: "routine" | "special"; specialKind?: Reminder["specialKind"] },
): Promise<Reminder> {
  const reminders = await readReminders(config);
  const normalizedRecurrence = normalizeRecurrence(recurrence);
  let normalizedScheduledAt = normalizeScheduledAt(scheduledAt);
  if (normalizedRecurrence.kind === "lunarYearly") {
    normalizedScheduledAt = nextLunarYearlyOccurrence(normalizedScheduledAt, new Date(Date.now() - 1000), normalizedRecurrence);
  }
  const reminder: Reminder = {
    id: `rmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text,
    scheduledAt: normalizedScheduledAt,
    recurrence: normalizedRecurrence,
    category: metadata?.category || "routine",
    specialKind: metadata?.specialKind,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  reminders.push(reminder);
  await writeReminders(config, reminders);
  return reminder;
}

function eventReminderTime(event: AutoReminderEvent): { hour: number; minute: number } {
  return {
    hour: event.reminderTime?.hour ?? 9,
    minute: event.reminderTime?.minute ?? 0,
  };
}

function eventOffsets(event: AutoReminderEvent): number[] {
  const offsets = event.offsetsDays && event.offsetsDays.length > 0 ? event.offsetsDays : [0, -7, -1];
  return Array.from(new Set(offsets.filter((value) => Number.isInteger(value)))).sort((a, b) => a - b);
}

function eventReminderText(config: AppConfig, event: AutoReminderEvent, offsetDays: number): string {
  if (offsetDays === 0) {
    return t(config, "event_reminder_exact", { title: event.title });
  }
  return t(config, "event_reminder_offset", { title: event.title, days: Math.abs(offsetDays) });
}

function eventReminderRecurrence(event: AutoReminderEvent, offsetDays: number): ReminderRecurrence {
  if (event.calendar === "chinese-lunar") {
    return {
      kind: "lunarYearly",
      month: event.month,
      day: event.day,
      isLeapMonth: event.isLeapMonth,
      leapMonthPolicy: event.leapMonthPolicy,
      offsetDays,
    };
  }
  return {
    kind: "yearly",
    every: 1,
    month: event.month,
    day: event.day,
    offsetDays,
  };
}

export function resolveBuiltinFestivalEvent(name: string, reminderTime?: { hour: number; minute: number }, offsetsDays?: number[]): AutoReminderEvent | null {
  const base = BUILTIN_FESTIVALS[name.trim()];
  if (!base) return null;
  return {
    ...base,
    reminderTime,
    offsetsDays,
  };
}

export async function createAutoEventReminders(config: AppConfig, event: AutoReminderEvent, referenceTimeIso: string): Promise<Reminder[]> {
  const reference = new Date(referenceTimeIso);
  const time = eventReminderTime(event);
  const scheduledAt = new Date(reference.getTime());
  scheduledAt.setHours(time.hour, time.minute, 0, 0);
  const created: Reminder[] = [];
  for (const offsetDays of eventOffsets(event)) {
    created.push(await createReminder(
      config,
      eventReminderText(config, event, offsetDays),
      scheduledAt.toISOString(),
      eventReminderRecurrence(event, offsetDays),
      { category: "special", specialKind: event.kind },
    ));
  }
  return created;
}

export async function listPendingReminders(config: AppConfig): Promise<Reminder[]> {
  const reminders = await readReminders(config);
  return reminders.filter((item) => item.status === "pending").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export async function getReminder(config: AppConfig, id: string): Promise<Reminder | null> {
  const reminders = await readReminders(config);
  return reminders.find((item) => item.id === id) || null;
}

export async function deleteReminder(config: AppConfig, id: string): Promise<boolean> {
  const reminders = await readReminders(config);
  let changed = false;
  const next = reminders.map((item) => {
    if (item.id === id && item.status === "pending") {
      changed = true;
      return { ...item, status: "deleted" as const };
    }
    return item;
  });
  if (changed) {
    await writeReminders(config, next);
  }
  return changed;
}

function recurrenceKind(reminder: Reminder): ReminderRecurrence["kind"] {
  return normalizeRecurrence(reminder.recurrence, reminder.repeat).kind;
}

function isRecurring(reminder: Reminder): boolean {
  return recurrenceKind(reminder) !== "once";
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

function nthWeekdayOfMonth(year: number, monthIndex: number, weekOfMonth: number, dayOfWeek: number, template: Date): Date | null {
  if (weekOfMonth === -1) {
    const lastDay = new Date(year, monthIndex + 1, 0);
    const offset = (lastDay.getDay() - dayOfWeek + 7) % 7;
    const candidate = new Date(year, monthIndex, lastDay.getDate() - offset, template.getHours(), template.getMinutes(), template.getSeconds(), template.getMilliseconds());
    return candidate.getMonth() === monthIndex ? candidate : null;
  }
  const firstDay = new Date(year, monthIndex, 1);
  const offset = (dayOfWeek - firstDay.getDay() + 7) % 7;
  const day = 1 + offset + (weekOfMonth - 1) * 7;
  const candidate = new Date(year, monthIndex, day, template.getHours(), template.getMinutes(), template.getSeconds(), template.getMilliseconds());
  return candidate.getMonth() === monthIndex ? candidate : null;
}

function nextIntervalOccurrence(baseIso: string, now: Date, recurrence: Extract<ReminderRecurrence, { kind: "interval" }>): string {
  let candidate = new Date(baseIso);
  if (!Number.isFinite(candidate.getTime())) throw new Error(`Invalid reminder time: ${baseIso}`);
  while (candidate.getTime() <= now.getTime()) {
    if (recurrence.unit === "minute") candidate = new Date(candidate.getTime() + recurrence.every * MS_PER_MINUTE);
    else if (recurrence.unit === "hour") candidate = new Date(candidate.getTime() + recurrence.every * MS_PER_HOUR);
    else if (recurrence.unit === "day") candidate = new Date(candidate.getTime() + recurrence.every * MS_PER_DAY);
    else if (recurrence.unit === "week") candidate = new Date(candidate.getTime() + recurrence.every * 7 * MS_PER_DAY);
    else if (recurrence.unit === "month") candidate = addMonths(candidate, recurrence.every);
    else candidate = addYears(candidate, recurrence.every);
  }
  return candidate.toISOString();
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
      candidate = nthWeekdayOfMonth(target.getFullYear(), target.getMonth(), recurrence.weekOfMonth, recurrence.dayOfWeek, base);
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
    const monthIndex = recurrence.month - 1;
    const actualEvent = new Date(year, monthIndex, monthDay(year, monthIndex, recurrence.day), base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
    const candidate = new Date(actualEvent.getTime() + offsetDays * MS_PER_DAY);
    if (candidate.getTime() <= now.getTime()) continue;
    return candidate.toISOString();
  }
  throw new Error(`Failed to compute next yearly reminder from ${baseIso}`);
}

function lunarMonthLabel(month: number, isLeapMonth = false): string {
  return `${isLeapMonth ? "闰" : ""}${solarLunar.toChinaMonth(month)}`;
}

function lunarDayLabel(day: number): string {
  return solarLunar.toChinaDay(day);
}

function lunarCandidateDates(lunarYear: number, recurrence: Extract<ReminderRecurrence, { kind: "lunarYearly" }>, template: Date): Date[] {
  const leapMonth = solarLunar.leapMonth(lunarYear);
  const useLeap = recurrence.isLeapMonth === true;
  const policy = recurrence.leapMonthPolicy || "prefer-non-leap";
  const variants: boolean[] = [];

  if (!useLeap) {
    variants.push(false);
  } else if (policy === "same-leap-only") {
    if (leapMonth === recurrence.month) variants.push(true);
  } else if (policy === "both") {
    variants.push(false);
    if (leapMonth === recurrence.month) variants.push(true);
  } else {
    variants.push(false);
  }

  return Array.from(new Set(variants)).map((isLeapMonth) => {
    const converted = solarLunar.lunar2solar(lunarYear, recurrence.month, recurrence.day, isLeapMonth);
    if (converted === -1) return null;
    return new Date(converted.cYear, converted.cMonth - 1, converted.cDay, template.getHours(), template.getMinutes(), template.getSeconds(), template.getMilliseconds());
  }).filter((item): item is Date => Boolean(item)).sort((a, b) => a.getTime() - b.getTime());
}

function nextLunarYearlyOccurrence(baseIso: string, now: Date, recurrence: Extract<ReminderRecurrence, { kind: "lunarYearly" }>): string {
  const base = new Date(baseIso);
  if (!Number.isFinite(base.getTime())) throw new Error(`Invalid reminder time: ${baseIso}`);
  const nowLunar = solarLunar.solar2lunar(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (nowLunar === -1) throw new Error(`Failed to convert current date to lunar date: ${now.toISOString()}`);
  const offsetDays = recurrence.offsetDays || 0;
  for (let lunarYear = nowLunar.lYear; lunarYear <= nowLunar.lYear + 120; lunarYear += 1) {
    for (const actualEvent of lunarCandidateDates(lunarYear, recurrence, base)) {
      const candidate = new Date(actualEvent.getTime() + offsetDays * MS_PER_DAY);
      if (candidate.getTime() <= now.getTime()) continue;
      return candidate.toISOString();
    }
  }
  throw new Error(`Failed to compute next lunar reminder from ${baseIso}`);
}

function nextReminderOccurrence(reminder: Reminder, now = new Date()): string | null {
  const recurrence = normalizeRecurrence(reminder.recurrence, reminder.repeat);
  if (recurrence.kind === "once") return null;
  if (recurrence.kind === "interval") return nextIntervalOccurrence(reminder.scheduledAt, now, recurrence);
  if (recurrence.kind === "weekly") return nextWeeklyOccurrence(reminder.scheduledAt, now, recurrence);
  if (recurrence.kind === "monthly") return nextMonthlyOccurrence(reminder.scheduledAt, now, recurrence);
  if (recurrence.kind === "yearly") return nextYearlyOccurrence(reminder.scheduledAt, now, recurrence);
  return nextLunarYearlyOccurrence(reminder.scheduledAt, now, recurrence);
}

function weekdayLabel(config: AppConfig, day: number): string {
  return t(config, `weekday_short_${day}`);
}

function offsetSuffix(config: AppConfig, offsetDays = 0): string {
  if (offsetDays === 0) return "";
  return t(config, "reminder_offset_days_before", { days: Math.abs(offsetDays) });
}

function reminderRecurrenceText(config: AppConfig, reminder: Reminder): string {
  const recurrence = normalizeRecurrence(reminder.recurrence, reminder.repeat);
  if (recurrence.kind === "interval") {
    if (recurrence.unit === "day" && recurrence.every === 1) return t(config, "reminder_repeat_daily");
    return t(config, "reminder_repeat_interval", { every: recurrence.every, unit: t(config, `reminder_unit_${recurrence.unit}`) });
  }
  if (recurrence.kind === "weekly") {
    if (recurrence.every === 1 && recurrence.daysOfWeek.join(",") === "1,2,3,4,5") return t(config, "reminder_repeat_weekdays");
    return t(config, "reminder_repeat_weekly", {
      every: recurrence.every,
      days: recurrence.daysOfWeek.map((day) => weekdayLabel(config, day)).join(", "),
    });
  }
  if (recurrence.kind === "monthly") {
    if (recurrence.mode === "dayOfMonth") {
      return t(config, "reminder_repeat_monthly_day", { every: recurrence.every, day: recurrence.dayOfMonth });
    }
    return t(config, "reminder_repeat_monthly_nth_weekday", {
      every: recurrence.every,
      ordinal: t(config, `ordinal_${recurrence.weekOfMonth}`),
      day: weekdayLabel(config, recurrence.dayOfWeek),
    });
  }
  if (recurrence.kind === "yearly") {
    return t(config, "reminder_repeat_yearly", {
      every: recurrence.every,
      month: recurrence.month,
      day: recurrence.day,
      offset: offsetSuffix(config, recurrence.offsetDays),
    }).trim();
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

function reminderRepeatLabel(config: AppConfig, reminder: Reminder): string {
  return isRecurring(reminder) ? `[${reminderRecurrenceText(config, reminder)}]` : "";
}

export async function deliverDueReminders(
  config: AppConfig,
  bot: Bot<Context>,
  renderMessage?: (reminder: Reminder, fallback: string) => Promise<string>,
): Promise<number> {
  const reminders = await readReminders(config);
  const now = new Date();
  let sent = 0;
  let changed = false;
  for (const reminder of reminders) {
    if (reminder.status !== "pending") continue;
    const ts = Date.parse(reminder.scheduledAt);
    if (!Number.isFinite(ts) || ts > now.getTime()) continue;
    const fallbackMessage = t(config, "reminder_delivery", { text: reminder.text });
    const deliveryMessage = renderMessage ? await renderMessage(reminder, fallbackMessage) : fallbackMessage;
    for (const userId of config.telegram.allowedUserIds) {
      await sendMessageFormatted(bot, userId, deliveryMessage);
    }
    const nextScheduledAt = nextReminderOccurrence(reminder, now);
    if (nextScheduledAt) {
      reminder.scheduledAt = nextScheduledAt;
      reminder.sentAt = now.toISOString();
    } else {
      reminder.status = "sent";
      reminder.sentAt = now.toISOString();
    }
    sent += 1;
    changed = true;
  }
  if (changed) await writeReminders(config, reminders);
  return sent;
}

function formatReminder(config: AppConfig, reminder: Reminder): string {
  const repeatLabel = reminderRepeatLabel(config, reminder);
  return `${new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false }).slice(0, 16)}${repeatLabel ? ` ${repeatLabel}` : ""} ${reminder.text}`;
}

function filterReminders(reminders: Reminder[], view: ReminderView): Reminder[] {
  if (view === "all") return reminders;
  if (view === "upcoming") {
    const now = Date.now();
    const end = now + UPCOMING_WINDOW_DAYS * MS_PER_DAY;
    return reminders.filter((item) => {
      const ts = Date.parse(item.scheduledAt);
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

function buildMenuKeyboard(config: AppConfig, reminders: Reminder[]): InlineKeyboard {
  return new InlineKeyboard()
    .text(menuLabel(config, "reminder_menu_upcoming", filterReminders(reminders, "upcoming").length), `${REMINDER_CALLBACK_PREFIX}menu:upcoming`).row()
    .text(menuLabel(config, "reminder_menu_routine", filterReminders(reminders, "routine").length), `${REMINDER_CALLBACK_PREFIX}menu:routine`).row()
    .text(menuLabel(config, "reminder_menu_special", filterReminders(reminders, "special").length), `${REMINDER_CALLBACK_PREFIX}menu:special`).row()
    .text(menuLabel(config, "reminder_menu_all", filterReminders(reminders, "all").length), `${REMINDER_CALLBACK_PREFIX}menu:all`);
}

function buildSpecialMenuKeyboard(config: AppConfig, reminders: Reminder[]): InlineKeyboard {
  return new InlineKeyboard()
    .text(menuLabel(config, "reminder_menu_special_birthday", filterReminders(reminders, "special:birthday").length), `${REMINDER_CALLBACK_PREFIX}menu:special:birthday`).row()
    .text(menuLabel(config, "reminder_menu_special_festival", filterReminders(reminders, "special:festival").length), `${REMINDER_CALLBACK_PREFIX}menu:special:festival`).row()
    .text(menuLabel(config, "reminder_menu_special_anniversary", filterReminders(reminders, "special:anniversary").length), `${REMINDER_CALLBACK_PREFIX}menu:special:anniversary`).row()
    .text(menuLabel(config, "reminder_menu_special_memorial", filterReminders(reminders, "special:memorial").length), `${REMINDER_CALLBACK_PREFIX}menu:special:memorial`).row()
    .text(t(config, "reminder_back"), `${REMINDER_CALLBACK_PREFIX}menu:root`);
}

function buildListKeyboard(config: AppConfig, reminders: Reminder[], page: number, view: ReminderView): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageSize = Math.max(1, config.telegram.menuPageSize);
  const totalPages = Math.max(1, Math.ceil(reminders.length / pageSize));
  const start = page * pageSize;
  const pageItems = reminders.slice(start, start + pageSize);
  pageItems.forEach((item) => keyboard.text(formatReminder(config, item).slice(0, 60), `${REMINDER_CALLBACK_PREFIX}view:${view}:${item.id}`).row());
  if (totalPages > 1) {
    if (page > 0) keyboard.text(t(config, "reminder_prev"), `${REMINDER_CALLBACK_PREFIX}page:${view}:${page - 1}`);
    if (page < totalPages - 1) keyboard.text(t(config, "reminder_next"), `${REMINDER_CALLBACK_PREFIX}page:${view}:${page + 1}`);
    keyboard.row();
  }
  keyboard.text(t(config, "reminder_back"), `${REMINDER_CALLBACK_PREFIX}menu:${view.startsWith("special:") ? "special" : "root"}`);
  return keyboard;
}

export async function showReminderList(config: AppConfig, ctx: Context): Promise<void> {
  const reminders = await listPendingReminders(config);
  await replyFormatted(ctx, t(config, "reminder_menu_title"), { reply_markup: buildMenuKeyboard(config, reminders) });
}

function buildDetailKeyboard(config: AppConfig, reminderId: string, view: ReminderView): InlineKeyboard {
  return new InlineKeyboard().text(t(config, "reminder_delete"), `${REMINDER_CALLBACK_PREFIX}delete:${view}:${reminderId}`).row().text(t(config, "reminder_back"), `${REMINDER_CALLBACK_PREFIX}page:${view}:0`);
}

function buildDeleteConfirmKeyboard(config: AppConfig, reminderId: string, view: ReminderView): InlineKeyboard {
  return new InlineKeyboard().text(t(config, "reminder_confirm_delete"), `${REMINDER_CALLBACK_PREFIX}confirm-delete:${view}:${reminderId}`).text(t(config, "reminder_cancel"), `${REMINDER_CALLBACK_PREFIX}view:${view}:${reminderId}`);
}

export async function handleReminderCallback(config: AppConfig, ctx: Context): Promise<boolean> {
  const callback = ctx.callbackQuery;
  const data = callback?.data || "";
  if (!data.startsWith(REMINDER_CALLBACK_PREFIX)) return false;
  const rest = data.slice(REMINDER_CALLBACK_PREFIX.length);
  if (!ctx.chat || !callback?.message?.message_id) return true;
  const messageId = callback.message.message_id;
  const reminders = await listPendingReminders(config);

  if (rest === "menu:root") {
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_menu_title"), { reply_markup: buildMenuKeyboard(config, reminders) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest === "menu:special") {
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, [
      t(config, "reminder_menu_special"),
      t(config, "reminder_special_summary", {
        birthday: filterReminders(reminders, "special:birthday").length,
        festival: filterReminders(reminders, "special:festival").length,
        anniversary: filterReminders(reminders, "special:anniversary").length,
        memorial: filterReminders(reminders, "special:memorial").length,
      }),
    ].join("\n"), { reply_markup: buildSpecialMenuKeyboard(config, reminders) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("menu:")) {
    const view = rest.slice(5) as ReminderView;
    const filtered = filterReminders(reminders, view);
    if (filtered.length === 0) {
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_none"), { reply_markup: view.startsWith("special") ? buildSpecialMenuKeyboard(config, reminders) : buildMenuKeyboard(config, reminders) });
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
    const filtered = filterReminders(reminders, view);
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
    const [, viewRaw, reminderId] = rest.split(":", 3);
    const view = (viewRaw || "all") as ReminderView;
    const reminder = await getReminder(config, reminderId);
    if (!reminder || reminder.status !== "pending") {
      await ctx.answerCallbackQuery({ text: t(config, "reminder_missing"), show_alert: true });
      return true;
    }
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_detail", {
      time: new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false }),
      repeat: reminderRecurrenceText(config, reminder),
      text: reminder.text,
    }), { reply_markup: buildDetailKeyboard(config, reminder.id, view) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("delete:")) {
    const [, viewRaw, reminderId] = rest.split(":", 3);
    const view = (viewRaw || "all") as ReminderView;
    const reminder = await getReminder(config, reminderId);
    if (!reminder || reminder.status !== "pending") {
      await ctx.answerCallbackQuery({ text: t(config, "reminder_missing"), show_alert: true });
      return true;
    }
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_delete_confirm", {
      time: new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false }),
      repeat: reminderRecurrenceText(config, reminder),
      text: reminder.text,
    }), { reply_markup: buildDeleteConfirmKeyboard(config, reminder.id, view) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (rest.startsWith("confirm-delete:")) {
    const [, viewRaw, reminderId] = rest.split(":", 3);
    const view = (viewRaw || "all") as ReminderView;
    await deleteReminder(config, reminderId);
    const refreshed = await listPendingReminders(config);
    const next = filterReminders(refreshed, view);
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

export function reminderScheduleSummary(config: AppConfig, reminder: Reminder): string {
  const time = new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false });
  const recurrence = normalizeRecurrence(reminder.recurrence, reminder.repeat);
  if (recurrence.kind === "interval") {
    if (recurrence.unit === "day" && recurrence.every === 1) return t(config, "reminder_created_daily", { time });
    return t(config, "reminder_created_interval", { every: recurrence.every, unit: t(config, `reminder_unit_${recurrence.unit}`), time });
  }
  if (recurrence.kind === "weekly") {
    if (recurrence.every === 1 && recurrence.daysOfWeek.join(",") === "1,2,3,4,5") return t(config, "reminder_created_weekdays", { time });
    return t(config, "reminder_created_weekly", {
      every: recurrence.every,
      days: recurrence.daysOfWeek.map((day) => weekdayLabel(config, day)).join(", "),
      time,
    });
  }
  if (recurrence.kind === "monthly") {
    if (recurrence.mode === "dayOfMonth") {
      return t(config, "reminder_created_monthly_day", { every: recurrence.every, day: recurrence.dayOfMonth, time });
    }
    return t(config, "reminder_created_monthly_nth_weekday", {
      every: recurrence.every,
      ordinal: t(config, `ordinal_${recurrence.weekOfMonth}`),
      day: weekdayLabel(config, recurrence.dayOfWeek),
      time,
    });
  }
  if (recurrence.kind === "yearly") {
    return t(config, "reminder_created_yearly", {
      every: recurrence.every,
      month: recurrence.month,
      day: recurrence.day,
      offset: offsetSuffix(config, recurrence.offsetDays),
      time,
    }).trim();
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

export function summarizeCreatedReminders(config: AppConfig, reminders: Reminder[]): string {
  return reminders.map((reminder) => `- ${reminderScheduleSummary(config, reminder)}：${reminder.text}`).join("\n");
}

export async function startReminderLoop(
  config: AppConfig,
  bot: Bot<Context>,
  renderMessage?: (reminder: Reminder, fallback: string) => Promise<string>,
): Promise<NodeJS.Timeout> {
  return setInterval(async () => {
    try {
      const sent = await deliverDueReminders(config, bot, renderMessage);
      if (sent > 0) await logger.info(`sent ${sent} reminders`);
    } catch (error) {
      await logger.error(`reminder loop failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 30000);
}
