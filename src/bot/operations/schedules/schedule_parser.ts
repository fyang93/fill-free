import type { ScheduleSchedule } from "./types";
import { normalizeRecurrence, normalizeScheduledAt } from "./schedule";

function parseScheduleTime(raw: unknown): { hour: number; minute: number } {
  if (typeof raw === "string" && raw.trim()) {
    const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      return { hour: Number(match[1]), minute: Number(match[2]) };
    }
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    return { hour: Number(record.hour), minute: Number(record.minute) };
  }
  return { hour: NaN, minute: NaN };
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseAnchorDate(raw: unknown): string | undefined {
  return cleanString(raw);
}

function buildExternalDateTimeString(raw: Record<string, unknown>): string {
  const direct = [raw.at, raw.scheduledAt, raw.datetime, raw.dateTime]
    .map(cleanString)
    .find(Boolean);
  if (direct) return direct;

  const structuredDate = Number.isInteger(Number(raw.year)) && Number(raw.year) > 0 && Number.isInteger(Number(raw.month)) && Number(raw.month) >= 1 && Number(raw.month) <= 12 && Number.isInteger(Number(raw.day)) && Number(raw.day) >= 1 && Number(raw.day) <= 31
    ? `${String(Number(raw.year)).padStart(4, "0")}-${String(Number(raw.month)).padStart(2, "0")}-${String(Number(raw.day)).padStart(2, "0")}`
    : "";
  const date = cleanString(raw.date) || structuredDate || "";
  const time = cleanString(raw.time)
    ? cleanString(raw.time)!
    : raw.time && typeof raw.time === "object"
      ? (() => {
          const parsed = parseScheduleTime(raw.time);
          if (!Number.isInteger(parsed.hour) || !Number.isInteger(parsed.minute)) return "";
          return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
        })()
      : "";

  if (date && time) return `${date}T${time}:00`;
  if (date) return `${date}T00:00:00`;
  return "";
}

function hasConcreteOnceDateTime(raw: Record<string, unknown>): boolean {
  const directDateTime = buildExternalDateTimeString(raw);
  if (/^\d{4}-\d{2}-\d{2}T/.test(directDateTime)) return true;
  const year = Number(raw.year);
  const month = Number(raw.month);
  const day = Number(raw.day);
  return Number.isInteger(year) && year > 0 && Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31;
}

export function buildScheduleScheduleFromExternal(raw: Record<string, unknown>, timezone?: string): ScheduleSchedule {
  const rawKind = typeof raw.kind === "string" && raw.kind.trim()
    ? raw.kind.trim()
    : typeof raw.type === "string" && raw.type.trim()
      ? raw.type.trim()
      : "once";
  const normalizedKind = rawKind === "absolute" ? "once" : rawKind;
  const kind = normalizedKind !== "once" && hasConcreteOnceDateTime(raw) ? "once" : normalizedKind;

  if (kind === "once") {
    return {
      kind: "once",
      scheduledAt: normalizeScheduledAt(buildExternalDateTimeString(raw), timezone),
    };
  }

  if (kind === "interval" || kind === "daily") {
    const recurrence = normalizeRecurrence(raw);
    if (recurrence.kind !== "interval") throw new Error("Invalid interval schedule schedule");
    return {
      kind: "interval",
      unit: recurrence.unit,
      every: recurrence.every,
      anchorAt: normalizeScheduledAt(String(raw.anchor || raw.anchorAt || raw.at || raw.scheduledAt || ""), timezone),
    };
  }

  if (kind === "weekly" || kind === "weekdays" || kind === "weekends") {
    const recurrence = normalizeRecurrence(raw);
    const time = parseScheduleTime(raw.time);
    if (recurrence.kind !== "weekly") throw new Error("Invalid weekly schedule schedule");
    return { kind: "weekly", every: recurrence.every, daysOfWeek: recurrence.daysOfWeek, time, anchorDate: parseAnchorDate(raw.anchorDate) };
  }

  if (kind === "monthly") {
    const recurrence = normalizeRecurrence(raw);
    const time = parseScheduleTime(raw.time);
    if (recurrence.kind !== "monthly") throw new Error("Invalid monthly schedule schedule");
    if (recurrence.mode === "dayOfMonth") {
      return { kind: "monthly", every: recurrence.every, mode: recurrence.mode, dayOfMonth: recurrence.dayOfMonth, time, anchorDate: parseAnchorDate(raw.anchorDate) };
    }
    return { kind: "monthly", every: recurrence.every, mode: recurrence.mode, weekOfMonth: recurrence.weekOfMonth, dayOfWeek: recurrence.dayOfWeek, time, anchorDate: parseAnchorDate(raw.anchorDate) };
  }

  if (kind === "yearly") {
    const recurrence = normalizeRecurrence(raw);
    const time = parseScheduleTime(raw.time);
    if (recurrence.kind !== "yearly") throw new Error("Invalid yearly schedule schedule");
    return { kind: "yearly", every: recurrence.every, month: recurrence.month, day: recurrence.day, time };
  }

  if (kind === "lunarYearly") {
    const recurrence = normalizeRecurrence(raw);
    const time = parseScheduleTime(raw.time);
    if (recurrence.kind !== "lunarYearly") throw new Error("Invalid lunar schedule schedule");
    return { kind: "lunarYearly", month: recurrence.month, day: recurrence.day, isLeapMonth: recurrence.isLeapMonth, leapMonthPolicy: recurrence.leapMonthPolicy, time };
  }

  throw new Error(`Unsupported schedule schedule kind: ${kind}`);
}

export function normalizeStoredScheduleSchedule(raw: unknown): ScheduleSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : "";

  try {
    if (kind === "once") {
      return buildScheduleScheduleFromExternal({ kind, scheduledAt: record.scheduledAt });
    }
    if (kind === "interval") {
      return buildScheduleScheduleFromExternal({ kind, every: record.every, unit: record.unit, anchorAt: record.anchorAt });
    }
    if (kind === "weekly") {
      return buildScheduleScheduleFromExternal({ kind, every: record.every, daysOfWeek: record.daysOfWeek, time: record.time, anchorDate: record.anchorDate });
    }
    if (kind === "monthly") {
      return buildScheduleScheduleFromExternal({
        kind,
        every: record.every,
        mode: record.mode,
        dayOfMonth: record.dayOfMonth,
        weekOfMonth: record.weekOfMonth,
        dayOfWeek: record.dayOfWeek,
        time: record.time,
        anchorDate: record.anchorDate,
      });
    }
    if (kind === "yearly") {
      return buildScheduleScheduleFromExternal({ kind, every: record.every, month: record.month, day: record.day, time: record.time });
    }
    if (kind === "lunarYearly") {
      return buildScheduleScheduleFromExternal({
        kind,
        month: record.month,
        day: record.day,
        isLeapMonth: record.isLeapMonth,
        leapMonthPolicy: record.leapMonthPolicy,
        time: record.time,
      });
    }
  } catch {
    return null;
  }

  return null;
}
