import type { AppConfig } from "bot/app/types";
import { logger } from "bot/app/logger";
import type { AiService } from "bot/ai";
import type { ScheduleEvent, ScheduleNotificationInstance } from "./types";
import { getCurrentOccurrence, listNotificationInstances, scheduleEventScheduleSummary } from "./schedule";
import { scheduledTaskPromptForEvent, buildScheduledTaskPrompt } from "./scheduled-task";
import { readScheduleEvents, writeScheduleEvents } from "./store";

const PERIODIC_PREWARM_WINDOW_MS = 24 * 60 * 60 * 1000;

export { buildScheduledTaskPrompt, scheduledTaskPromptForEvent };

export function shouldGenerateScheduledTaskOnDelivery(event: ScheduleEvent): boolean {
  return event.category === "scheduled-task";
}

export function clearPreparedScheduleDeliveryText(event: ScheduleEvent): boolean {
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

export function isPreparedScheduleDeliveryTextUsable(event: ScheduleEvent, instance: ScheduleNotificationInstance): boolean {
  return Boolean(
    event.deliveryText
    && event.deliveryPreparedNotificationId === instance.notificationId
    && event.deliveryPreparedNotifyAt === instance.notifyAt,
  );
}

export function nextPendingScheduleInstance(event: ScheduleEvent, now = new Date()): ScheduleNotificationInstance | null {
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

export function shouldPrepareScheduleDeliveryText(event: ScheduleEvent, now = new Date()): boolean {
  if (shouldGenerateScheduledTaskOnDelivery(event)) return false;
  const nextInstance = nextPendingScheduleInstance(event, now);
  if (!nextInstance) return false;
  if (event.schedule.kind === "once") return true;
  const notifyAt = Date.parse(nextInstance.notifyAt);
  return Number.isFinite(notifyAt) && notifyAt - now.getTime() <= PERIODIC_PREWARM_WINDOW_MS;
}

export async function prepareScheduleDeliveryText(config: AppConfig, agentService: AiService, event: ScheduleEvent, now = new Date()): Promise<boolean> {
  if (shouldGenerateScheduledTaskOnDelivery(event)) {
    return clearPreparedScheduleDeliveryText(event);
  }
  const nextInstance = nextPendingScheduleInstance(event, now);
  if (!nextInstance) {
    return clearPreparedScheduleDeliveryText(event);
  }
  if (event.schedule.kind !== "once") {
    const notifyAt = Date.parse(nextInstance.notifyAt);
    if (!Number.isFinite(notifyAt) || notifyAt - now.getTime() > PERIODIC_PREWARM_WINDOW_MS) {
      return clearPreparedScheduleDeliveryText(event);
    }
  }
  if (isPreparedScheduleDeliveryTextUsable(event, nextInstance)) {
    return false;
  }
  const message = await agentService.generateScheduleMessage(
    event.title,
    nextInstance.notifyAt,
    scheduleEventScheduleSummary(config, event),
  );
  const trimmed = message.trim();
  if (!trimmed) return false;
  event.deliveryText = trimmed;
  event.deliveryTextGeneratedAt = new Date().toISOString();
  event.deliveryPreparedNotificationId = nextInstance.notificationId;
  event.deliveryPreparedNotifyAt = nextInstance.notifyAt;
  return true;
}

export async function prewarmScheduleDeliveryTexts(config: AppConfig, agentService: AiService): Promise<void> {
  const events = await readScheduleEvents(config);
  let changed = false;
  const now = new Date();
  for (const event of events) {
    if (event.status !== "active") continue;
    try {
      if (await prepareScheduleDeliveryText(config, agentService, event, now)) changed = true;
    } catch (error) {
      await logger.warn(`failed to prewarm schedule message for ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (changed) {
    await writeScheduleEvents(config, events);
    await logger.info("prewarmed schedule delivery texts");
  }
}
