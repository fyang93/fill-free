import solarLunar from "solarlunar";
import type { AppConfig } from "scheduling/app/types";
import { t, uiLocaleTag } from "scheduling/app/i18n";
import type {
  ReminderEvent,
  ReminderNotificationInstance,
  ReminderOccurrence,
  ReminderRecurrence,
  ReminderSchedule,
} from "./types";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const zonedDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const displayDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

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
  return Math.min(requestedDay, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate());
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

type LocalDateParts = { year: number; month: number; day: number };
type LocalDateTimeParts = LocalDateParts & { hour: number; minute: number; second?: number };

function zonedFormatter(timezone: string): Intl.DateTimeFormat {
  const existing = zonedDateTimeFormatters.get(timezone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  zonedDateTimeFormatters.set(timezone, created);
  return created;
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = zonedFormatter(timezone).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
    weekday: WEEKDAY_INDEX[byType.weekday] ?? 0,
  };
}

function displayDateTimeFormatter(config: AppConfig, timezone: string): Intl.DateTimeFormat {
  const key = `${uiLocaleTag(config)}::${timezone}`;
  const existing = displayDateTimeFormatters.get(key);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat(uiLocaleTag(config), {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  displayDateTimeFormatters.set(key, created);
  return created;
}

function formatDisplayDateTime(config: AppConfig, iso: string, timezone: string): string {
  return displayDateTimeFormatter(config, timezone).format(new Date(iso));
}

function compareLocalDateTime(a: LocalDateTimeParts, b: LocalDateTimeParts): number {
  return Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute, a.second || 0) - Date.UTC(b.year, b.month - 1, b.day, b.hour, b.minute, b.second || 0);
}

function localDateOnly(input: LocalDateTimeParts | LocalDateParts): LocalDateParts {
  return { year: input.year, month: input.month, day: input.day };
}

function addLocalDays(date: LocalDateParts, amount: number): LocalDateParts {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function addLocalMonths(date: LocalDateParts, amount: number): LocalDateParts {
  const first = new Date(Date.UTC(date.year, date.month - 1, 1));
  first.setUTCMonth(first.getUTCMonth() + amount);
  return { year: first.getUTCFullYear(), month: first.getUTCMonth() + 1, day: monthDay(first.getUTCFullYear(), first.getUTCMonth(), date.day) };
}

function addLocalYears(date: LocalDateParts, amount: number): LocalDateParts {
  const year = date.year + amount;
  return { year, month: date.month, day: monthDay(year, date.month - 1, date.day) };
}

function localDateWeekday(date: LocalDateParts): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function localStartOfWeek(date: LocalDateParts): number {
  const weekday = localDateWeekday(date);
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day - weekday) / MS_PER_DAY);
}

function localWeeksBetween(a: LocalDateParts, b: LocalDateParts): number {
  return Math.floor((localStartOfWeek(b) - localStartOfWeek(a)) / 7);
}

function zonedLocalDateTimeToUtc(dateTime: LocalDateTimeParts, timezone: string): Date {
  let guess = new Date(Date.UTC(dateTime.year, dateTime.month - 1, dateTime.day, dateTime.hour, dateTime.minute, dateTime.second || 0, 0));
  for (let i = 0; i < 6; i += 1) {
    const actual = getZonedParts(guess, timezone);
    const diff = compareLocalDateTime(dateTime, actual);
    if (diff === 0) return guess;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
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

function nextLocalWeeklyOccurrence(schedule: Extract<ReminderSchedule, { kind: "weekly" }>, reference: Date, timezone: string): string {
  const start = getZonedParts(reference, timezone);
  const startDate = localDateOnly(start);
  const anchor = schedule.anchorDate
    ? (() => {
        const [year, month, day] = schedule.anchorDate.split("-").map(Number);
        return { year, month, day } satisfies LocalDateParts;
      })()
    : startDate;
  for (let offset = 0; offset <= 366 * Math.max(1, schedule.every); offset += 1) {
    const candidateDate = addLocalDays(startDate, offset);
    const candidateWeekday = localDateWeekday(candidateDate);
    if (!schedule.daysOfWeek.includes(candidateWeekday)) continue;
    const passedWeeks = localWeeksBetween(anchor, candidateDate);
    if (passedWeeks % schedule.every !== 0) continue;
    const candidateUtc = zonedLocalDateTimeToUtc({ ...candidateDate, hour: schedule.time.hour, minute: schedule.time.minute }, timezone);
    if (candidateUtc.getTime() < reference.getTime()) continue;
    return candidateUtc.toISOString();
  }
  throw new Error("Failed to compute next local weekly event occurrence");
}

function nthWeekdayOfMonthLocal(year: number, month: number, weekOfMonth: number, dayOfWeek: number): LocalDateParts | null {
  if (weekOfMonth === -1) {
    const last = { year, month, day: monthDay(year, month - 1, 31) };
    const offset = (localDateWeekday(last) - dayOfWeek + 7) % 7;
    return addLocalDays(last, -offset);
  }
  const first = { year, month, day: 1 };
  const offset = (dayOfWeek - localDateWeekday(first) + 7) % 7;
  const day = 1 + offset + (weekOfMonth - 1) * 7;
  if (day > monthDay(year, month - 1, 31)) return null;
  return { year, month, day };
}

function nextLocalMonthlyOccurrence(schedule: Extract<ReminderSchedule, { kind: "monthly" }>, reference: Date, timezone: string): string {
  const start = getZonedParts(reference, timezone);
  const startMonth = { year: start.year, month: start.month, day: 1 };
  const anchor = schedule.anchorDate
    ? (() => {
        const [year, month, day] = schedule.anchorDate.split("-").map(Number);
        return { year, month, day } satisfies LocalDateParts;
      })()
    : localDateOnly(start);
  for (let monthOffset = 0; monthOffset <= schedule.every * 120; monthOffset += 1) {
    const monthBase = addLocalMonths(startMonth, monthOffset);
    const monthsSinceAnchor = (monthBase.year - anchor.year) * 12 + (monthBase.month - anchor.month);
    if (monthsSinceAnchor < 0 || monthsSinceAnchor % schedule.every !== 0) continue;
    const candidateDate = schedule.mode === "dayOfMonth"
      ? { year: monthBase.year, month: monthBase.month, day: monthDay(monthBase.year, monthBase.month - 1, schedule.dayOfMonth) }
      : nthWeekdayOfMonthLocal(monthBase.year, monthBase.month, schedule.weekOfMonth, schedule.dayOfWeek);
    if (!candidateDate) continue;
    const candidateUtc = zonedLocalDateTimeToUtc({ ...candidateDate, hour: schedule.time.hour, minute: schedule.time.minute }, timezone);
    if (candidateUtc.getTime() < reference.getTime()) continue;
    return candidateUtc.toISOString();
  }
  throw new Error("Failed to compute next local monthly event occurrence");
}

function nextLocalYearlyOccurrence(schedule: Extract<ReminderSchedule, { kind: "yearly" }>, reference: Date, timezone: string): string {
  const start = getZonedParts(reference, timezone);
  for (let year = start.year; year <= start.year + schedule.every * 100; year += 1) {
    const candidateDate = { year, month: schedule.month, day: monthDay(year, schedule.month - 1, schedule.day) };
    const candidateUtc = zonedLocalDateTimeToUtc({ ...candidateDate, hour: schedule.time.hour, minute: schedule.time.minute }, timezone);
    if (candidateUtc.getTime() < reference.getTime()) continue;
    return candidateUtc.toISOString();
  }
  throw new Error("Failed to compute next local yearly event occurrence");
}

function nextLocalLunarOccurrence(schedule: Extract<ReminderSchedule, { kind: "lunarYearly" }>, reference: Date, timezone: string): string {
  const referenceLocal = getZonedParts(reference, timezone);
  const nowLunar = solarLunar.solar2lunar(referenceLocal.year, referenceLocal.month, referenceLocal.day);
  if (nowLunar === -1) throw new Error(`Failed to convert current date to lunar date: ${reference.toISOString()}`);
  for (let lunarYear = nowLunar.lYear; lunarYear <= nowLunar.lYear + 120; lunarYear += 1) {
    const leapMonth = solarLunar.leapMonth(lunarYear);
    const variants: boolean[] = [];
    if (!schedule.isLeapMonth) {
      variants.push(false);
    } else if ((schedule.leapMonthPolicy || "prefer-non-leap") === "same-leap-only") {
      if (leapMonth === schedule.month) variants.push(true);
    } else if ((schedule.leapMonthPolicy || "prefer-non-leap") === "both") {
      variants.push(false);
      if (leapMonth === schedule.month) variants.push(true);
    } else {
      variants.push(false);
    }
    for (const isLeapMonth of Array.from(new Set(variants))) {
      const converted = solarLunar.lunar2solar(lunarYear, schedule.month, schedule.day, isLeapMonth);
      if (converted === -1) continue;
      let candidateDate: LocalDateParts = { year: converted.cYear, month: converted.cMonth, day: converted.cDay };
      if (candidateDate.year < referenceLocal.year - 1) continue;
      const candidateUtc = zonedLocalDateTimeToUtc({ ...candidateDate, hour: schedule.time.hour, minute: schedule.time.minute }, timezone);
      if (candidateUtc.getTime() < reference.getTime()) continue;
      return candidateUtc.toISOString();
    }
  }
  throw new Error("Failed to compute next local lunar event occurrence");
}

function nextLocalIntervalOccurrence(schedule: Extract<ReminderSchedule, { kind: "interval" }>, reference: Date, timezone: string): string {
  if (schedule.unit === "minute" || schedule.unit === "hour") {
    return nextIntervalEventOccurrence(schedule, reference);
  }
  const anchorUtc = new Date(schedule.anchorAt);
  if (!Number.isFinite(anchorUtc.getTime())) throw new Error(`Invalid reminder time: ${schedule.anchorAt}`);
  const anchorLocal = getZonedParts(anchorUtc, timezone);
  let candidateDate = localDateOnly(anchorLocal);
  let candidateUtc = zonedLocalDateTimeToUtc({ ...candidateDate, hour: anchorLocal.hour, minute: anchorLocal.minute, second: anchorLocal.second }, timezone);
  while (candidateUtc.getTime() < reference.getTime()) {
    if (schedule.unit === "day") candidateDate = addLocalDays(candidateDate, schedule.every);
    else if (schedule.unit === "week") candidateDate = addLocalDays(candidateDate, schedule.every * 7);
    else if (schedule.unit === "month") candidateDate = addLocalMonths(candidateDate, schedule.every);
    else candidateDate = addLocalYears(candidateDate, schedule.every);
    candidateUtc = zonedLocalDateTimeToUtc({ ...candidateDate, hour: anchorLocal.hour, minute: anchorLocal.minute, second: anchorLocal.second }, timezone);
  }
  return candidateUtc.toISOString();
}

function nextScheduleOccurrence(schedule: ReminderSchedule, reference = new Date()): string | null {
  if (schedule.kind === "once") {
    return schedule.scheduledAt;
  }
  if (schedule.kind === "interval") return nextIntervalEventOccurrence(schedule, reference);
  if (schedule.kind === "weekly") return nextWeeklyEventOccurrence(schedule, reference);
  if (schedule.kind === "monthly") return nextMonthlyEventOccurrence(schedule, reference);
  if (schedule.kind === "yearly") return nextYearlyEventOccurrence(schedule, reference);
  return nextLunarEventOccurrence(schedule, reference);
}

function nextLocalScheduleOccurrence(event: ReminderEvent, reference = new Date()): string | null {
  const timezone = event.timezone;
  if (event.schedule.kind === "once") return event.schedule.scheduledAt;
  if (event.schedule.kind === "interval") return nextLocalIntervalOccurrence(event.schedule, reference, timezone);
  if (event.schedule.kind === "weekly") return nextLocalWeeklyOccurrence(event.schedule, reference, timezone);
  if (event.schedule.kind === "monthly") return nextLocalMonthlyOccurrence(event.schedule, reference, timezone);
  if (event.schedule.kind === "yearly") return nextLocalYearlyOccurrence(event.schedule, reference, timezone);
  return nextLocalLunarOccurrence(event.schedule, reference, timezone);
}

export function getCurrentOccurrence(event: ReminderEvent, now = new Date()): ReminderOccurrence | null {
  const existing = event.deliveryState?.currentOccurrence?.scheduledAt;
  if (existing) return { scheduledAt: existing };
  const scheduledAt = event.timeSemantics === "local"
    ? nextLocalScheduleOccurrence(event, now)
    : nextScheduleOccurrence(event.schedule, now);
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

export function reminderEventScheduleSummary(config: AppConfig, event: ReminderEvent): string {
  const schedule = event.schedule;
  if (schedule.kind === "once") {
    return formatDisplayDateTime(config, schedule.scheduledAt, event.timezone || config.bot.defaultTimezone);
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
  if (instance.offsetMinutes === 0) return t(config, "reminder_notification_now");
  const abs = Math.abs(instance.offsetMinutes);
  if (abs % 1440 === 0) return t(config, "reminder_offset_days_before", { days: abs / 1440 });
  if (abs % 60 === 0) return `${abs / 60}${t(config, "reminder_unit_hour")}`;
  return `${abs}${t(config, "reminder_unit_minute")}`;
}

export function formatReminderEvent(config: AppConfig, event: ReminderEvent): string {
  const occurrence = getCurrentOccurrence(event);
  const when = occurrence
    ? formatDisplayDateTime(config, occurrence.scheduledAt, event.timezone || config.bot.defaultTimezone).slice(0, 16)
    : reminderEventScheduleSummary(config, event);
  const notifications = occurrence
    ? listNotificationInstances(event, occurrence).map((item) => notificationLabel(config, item)).join("、")
    : event.notifications.map((item) => item.label || String(item.offsetMinutes)).join("、");
  return `${when} ${event.title}${notifications ? ` [${notifications}]` : ""}`;
}

