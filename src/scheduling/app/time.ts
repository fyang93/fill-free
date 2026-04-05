import { NtpTimeSync } from "ntp-time-sync";
import { logger } from "./logger";

const timeSync = NtpTimeSync.getInstance();
const WARN_INTERVAL_MS = 5 * 60 * 1000;
let lastWarnAt = 0;

export type ZonedDateTimeParts = {
  timezone: string;
  localDate: string;
  localTime: string;
  localDateTime: string;
  localWeekday: string;
};

export function formatIsoInTimezoneParts(iso: string | undefined, timezone: string | null | undefined): ZonedDateTimeParts | null {
  const resolvedTimezone = timezone?.trim();
  if (!iso || !resolvedTimezone) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolvedTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${byType.year}-${byType.month}-${byType.day}`;
  const localTime = `${byType.hour}:${byType.minute}:${byType.second}`;
  return {
    timezone: resolvedTimezone,
    localDate,
    localTime,
    localDateTime: `${localDate} ${localTime}`,
    localWeekday: String(byType.weekday || ""),
  };
}

export async function getAccurateNow(): Promise<Date> {
  try {
    const result = await timeSync.getTime();
    return result.now;
  } catch (error) {
    const now = Date.now();
    if (now - lastWarnAt >= WARN_INTERVAL_MS) {
      lastWarnAt = now;
      await logger.warn(`accurate time fallback to system clock: ${error instanceof Error ? error.message : String(error)}`);
    }
    return new Date(now);
  }
}

export async function getAccurateNowIso(): Promise<string> {
  return (await getAccurateNow()).toISOString();
}
