import type { ReminderSchedule } from "./types";
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

  const date = cleanString(raw.date) || "";
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

export function buildReminderScheduleFromExternal(raw: Record<string, unknown>, timezone?: string): ReminderSchedule {
  const rawKind = typeof raw.kind === "string" && raw.kind.trim()
    ? raw.kind.trim()
    : typeof raw.type === "string" && raw.type.trim()
      ? raw.type.trim()
      : "once";
  const kind = rawKind === "absolute" ? "once" : rawKind;

  if (kind === "once") {
    return {
      kind: "once",
      scheduledAt: normalizeScheduledAt(buildExternalDateTimeString(raw), timezone),
    };
  }

  if (kind === "interval") {
    const recurrence = normalizeRecurrence(raw);
    if (recurrence.kind !== "interval") throw new Error("Invalid interval reminder schedule");
    return {
      kind: "interval",
      unit: recurrence.unit,
      every: recurrence.every,
      anchorAt: normalizeScheduledAt(String(raw.anchor || raw.anchorAt || raw.at || raw.scheduledAt || ""), timezone),
    };
  }

  if (kind === "weekly") {
    const recurrence = normalizeRecurrence(raw);
    const time = parseScheduleTime(raw.time);
    if (recurrence.kind !== "weekly") throw new Error("Invalid weekly reminder schedule");
    return { kind: "weekly", every: recurrence.every, daysOfWeek: recurrence.daysOfWeek, time, anchorDate: parseAnchorDate(raw.anchorDate) };
  }

  if (kind === "monthly") {
    const recurrence = normalizeRecurrence(raw);
    const time = parseScheduleTime(raw.time);
    if (recurrence.kind !== "monthly") throw new Error("Invalid monthly reminder schedule");
    if (recurrence.mode === "dayOfMonth") {
      return { kind: "monthly", every: recurrence.every, mode: recurrence.mode, dayOfMonth: recurrence.dayOfMonth, time, anchorDate: parseAnchorDate(raw.anchorDate) };
    }
    return { kind: "monthly", every: recurrence.every, mode: recurrence.mode, weekOfMonth: recurrence.weekOfMonth, dayOfWeek: recurrence.dayOfWeek, time, anchorDate: parseAnchorDate(raw.anchorDate) };
  }

  if (kind === "yearly") {
    const recurrence = normalizeRecurrence(raw);
    const time = parseScheduleTime(raw.time);
    if (recurrence.kind !== "yearly") throw new Error("Invalid yearly reminder schedule");
    return { kind: "yearly", every: recurrence.every, month: recurrence.month, day: recurrence.day, time };
  }

  if (kind === "lunarYearly") {
    const recurrence = normalizeRecurrence(raw);
    const time = parseScheduleTime(raw.time);
    if (recurrence.kind !== "lunarYearly") throw new Error("Invalid lunar reminder schedule");
    return { kind: "lunarYearly", month: recurrence.month, day: recurrence.day, isLeapMonth: recurrence.isLeapMonth, leapMonthPolicy: recurrence.leapMonthPolicy, time };
  }

  throw new Error(`Unsupported reminder schedule kind: ${kind}`);
}

export function normalizeStoredReminderSchedule(raw: unknown): ReminderSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : "";

  try {
    if (kind === "once") {
      return buildReminderScheduleFromExternal({ kind, scheduledAt: record.scheduledAt });
    }
    if (kind === "interval") {
      return buildReminderScheduleFromExternal({ kind, every: record.every, unit: record.unit, anchorAt: record.anchorAt });
    }
    if (kind === "weekly") {
      return buildReminderScheduleFromExternal({ kind, every: record.every, daysOfWeek: record.daysOfWeek, time: record.time, anchorDate: record.anchorDate });
    }
    if (kind === "monthly") {
      return buildReminderScheduleFromExternal({
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
      return buildReminderScheduleFromExternal({ kind, every: record.every, month: record.month, day: record.day, time: record.time });
    }
    if (kind === "lunarYearly") {
      return buildReminderScheduleFromExternal({
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
