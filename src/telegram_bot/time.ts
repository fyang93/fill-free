import { NtpTimeSync } from "ntp-time-sync";
import { logger } from "./logger";

const timeSync = NtpTimeSync.getInstance();
const WARN_INTERVAL_MS = 5 * 60 * 1000;
let lastWarnAt = 0;

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
