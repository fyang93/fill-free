import type { AppConfig } from "../types";
import { logger } from "../logger";
import type { OpenCodeService } from "../opencode";
import type { ReminderEvent, ReminderNotificationInstance } from "./types";
import { getCurrentOccurrence, listNotificationInstances, reminderEventScheduleSummary } from "./schedule";
import { readReminderEvents, writeReminderEvents } from "./store";

const PERIODIC_PREWARM_WINDOW_MS = 24 * 60 * 60 * 1000;

export function clearPreparedReminderDeliveryText(event: ReminderEvent): boolean {
  const changed = Boolean(
    event.deliveryText
    || event.deliveryTextGeneratedAt
    || event.deliveryPreparedNotificationId
    || event.deliveryPreparedNotifyAt,
  );
  event.deliveryText = undefined;
  event.deliveryTextGeneratedAt = undefined;
  event.deliveryPreparedNotificationId = undefined;
  event.deliveryPreparedNotifyAt = undefined;
  return changed;
}

export function isPreparedReminderDeliveryTextUsable(event: ReminderEvent, instance: ReminderNotificationInstance): boolean {
  return Boolean(
    event.deliveryText
    && event.deliveryPreparedNotificationId === instance.notificationId
    && event.deliveryPreparedNotifyAt === instance.notifyAt,
  );
}

export function nextPendingReminderInstance(event: ReminderEvent, now = new Date()): ReminderNotificationInstance | null {
  const currentOccurrence = getCurrentOccurrence(event, now);
  if (currentOccurrence) {
    const sentIds = event.deliveryState?.currentOccurrence?.sentNotificationIds || [];
    const currentNext = listNotificationInstances(event, currentOccurrence).find((item) => !sentIds.includes(item.notificationId));
    if (currentNext) return currentNext;
  }
  if (event.schedule.kind === "once") return null;
  const reference = currentOccurrence ? new Date(new Date(currentOccurrence.scheduledAt).getTime() + 1000) : now;
  const nextOccurrence = getCurrentOccurrence({ ...event, deliveryState: undefined }, reference);
  if (!nextOccurrence) return null;
  return listNotificationInstances({ ...event, deliveryState: undefined }, nextOccurrence)[0] || null;
}

export function shouldPrepareReminderDeliveryText(event: ReminderEvent, now = new Date()): boolean {
  const nextInstance = nextPendingReminderInstance(event, now);
  if (!nextInstance) return false;
  if (event.schedule.kind === "once") return true;
  const notifyAt = Date.parse(nextInstance.notifyAt);
  return Number.isFinite(notifyAt) && notifyAt - now.getTime() <= PERIODIC_PREWARM_WINDOW_MS;
}

export async function prepareReminderDeliveryText(config: AppConfig, opencode: OpenCodeService, event: ReminderEvent, now = new Date()): Promise<boolean> {
  const nextInstance = nextPendingReminderInstance(event, now);
  if (!nextInstance) {
    return clearPreparedReminderDeliveryText(event);
  }
  if (event.schedule.kind !== "once") {
    const notifyAt = Date.parse(nextInstance.notifyAt);
    if (!Number.isFinite(notifyAt) || notifyAt - now.getTime() > PERIODIC_PREWARM_WINDOW_MS) {
      return clearPreparedReminderDeliveryText(event);
    }
  }
  if (isPreparedReminderDeliveryTextUsable(event, nextInstance)) {
    return false;
  }
  const message = await opencode.generateReminderMessage(
    event.title,
    nextInstance.notifyAt,
    reminderEventScheduleSummary(config, event),
    config.telegram.reminderMessageTimeoutMs,
  );
  const trimmed = message.trim();
  if (!trimmed) return false;
  event.deliveryText = trimmed;
  event.deliveryTextGeneratedAt = new Date().toISOString();
  event.deliveryPreparedNotificationId = nextInstance.notificationId;
  event.deliveryPreparedNotifyAt = nextInstance.notifyAt;
  return true;
}

export async function prewarmReminderDeliveryTexts(config: AppConfig, opencode: OpenCodeService): Promise<void> {
  const events = await readReminderEvents(config);
  let changed = false;
  const now = new Date();
  for (const event of events) {
    if (event.status !== "active") continue;
    try {
      if (await prepareReminderDeliveryText(config, opencode, event, now)) changed = true;
    } catch (error) {
      await logger.warn(`failed to prewarm reminder message for ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (changed) {
    await writeReminderEvents(config, events);
    await logger.info("prewarmed reminder delivery texts");
  }
}
