import type { Bot, Context } from "grammy";
import type { AppConfig } from "../types";
import { logger } from "../logger";
import { t } from "../i18n";
import { getAccurateNow } from "../time";
import { sendMessageFormatted } from "../telegram_format";
import type { ReminderEvent, ReminderNotificationInstance } from "./types";
import { allNotificationsSent, getCurrentOccurrence, listNotificationInstances } from "./schedule";
import { readReminderEvents, writeReminderEvents } from "./store";

function fallbackDeliveryMessage(config: AppConfig, event: ReminderEvent, instance: ReminderNotificationInstance): string {
  let label = event.title;
  if (instance.label) {
    label = `${event.title}（${instance.label}）`;
  } else if (instance.offsetMinutes < 0) {
    label = `${event.title}（提前${Math.abs(instance.offsetMinutes)}分钟）`;
  } else if (instance.offsetMinutes > 0) {
    label = `${event.title}（${instance.offsetMinutes}分钟后）`;
  }
  return t(config, "reminder_delivery", { text: label });
}

function markNotificationSent(event: ReminderEvent, notificationId: string): void {
  const current = event.deliveryState?.currentOccurrence;
  if (!current) return;
  if (!current.sentNotificationIds.includes(notificationId)) {
    current.sentNotificationIds.push(notificationId);
  }
}

function ensureOccurrenceState(event: ReminderEvent, now: Date): ReminderEvent | null {
  if (event.status !== "active") return null;
  const occurrence = getCurrentOccurrence(event, now);
  if (!occurrence) return null;
  if (!event.deliveryState?.currentOccurrence || event.deliveryState.currentOccurrence.scheduledAt !== occurrence.scheduledAt) {
    event.deliveryState = {
      currentOccurrence: {
        scheduledAt: occurrence.scheduledAt,
        sentNotificationIds: [],
      },
    };
  }
  return event;
}

function advanceOccurrence(event: ReminderEvent, now: Date): void {
  if (event.schedule.kind === "once") {
    event.status = "paused";
    event.updatedAt = now.toISOString();
    return;
  }
  const nextReference = new Date(new Date(event.deliveryState?.currentOccurrence?.scheduledAt || now.toISOString()).getTime() + 1000);
  const nextOccurrence = getCurrentOccurrence({ ...event, deliveryState: undefined }, nextReference);
  if (!nextOccurrence) {
    event.status = "paused";
    event.updatedAt = now.toISOString();
    return;
  }
  event.deliveryState = {
    currentOccurrence: {
      scheduledAt: nextOccurrence.scheduledAt,
      sentNotificationIds: [],
    },
  };
  event.updatedAt = now.toISOString();
}

export async function deliverDueReminders(
  config: AppConfig,
  bot: Bot<Context>,
  renderMessage?: (event: ReminderEvent, instance: ReminderNotificationInstance, fallback: string) => Promise<string>,
): Promise<number> {
  const events = await readReminderEvents(config);
  const now = await getAccurateNow();
  let sent = 0;
  let changed = false;

  for (const event of events) {
    if (event.status !== "active") continue;
    const activeEvent = ensureOccurrenceState(event, now);
    if (!activeEvent?.deliveryState?.currentOccurrence) continue;

    const instances = listNotificationInstances(activeEvent, { scheduledAt: activeEvent.deliveryState.currentOccurrence.scheduledAt });
    const dueInstances = instances.filter((instance) => {
      const alreadySent = activeEvent.deliveryState?.currentOccurrence?.sentNotificationIds.includes(instance.notificationId) || false;
      return !alreadySent && Date.parse(instance.notifyAt) <= now.getTime();
    });

    for (const instance of dueInstances) {
      const fallbackMessage = fallbackDeliveryMessage(config, activeEvent, instance);
      const deliveryMessage = renderMessage ? await renderMessage(activeEvent, instance, fallbackMessage) : fallbackMessage;
      for (const userId of config.telegram.allowedUserIds) {
        await sendMessageFormatted(bot, userId, deliveryMessage);
      }
      markNotificationSent(activeEvent, instance.notificationId);
      activeEvent.updatedAt = now.toISOString();
      sent += 1;
      changed = true;
    }

    if (allNotificationsSent(activeEvent)) {
      advanceOccurrence(activeEvent, now);
      changed = true;
    }
  }

  if (changed) await writeReminderEvents(config, events);
  return sent;
}

export async function startReminderLoop(
  config: AppConfig,
  bot: Bot<Context>,
  renderMessage?: (event: ReminderEvent, instance: ReminderNotificationInstance, fallback: string) => Promise<string>,
): Promise<NodeJS.Timeout> {
  let running = false;
  return setInterval(async () => {
    if (running) {
      await logger.warn("skipping reminder tick because previous delivery is still running");
      return;
    }
    running = true;
    try {
      const sent = await deliverDueReminders(config, bot, renderMessage);
      if (sent > 0) await logger.info(`sent ${sent} reminders`);
    } catch (error) {
      await logger.error(`reminder loop failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  }, 30000);
}
