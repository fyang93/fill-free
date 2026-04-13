import type { Bot, Context } from "grammy";
import type { AppConfig } from "bot/app/types";
import { logger } from "bot/app/logger";
import { tForLocale, userLocale, type Locale } from "bot/app/i18n";
import { getAccurateNow } from "bot/app/time";
import { sendMessageFormatted } from "bot/telegram/format";
import { listAuthorizedUserIds } from "bot/operations/access/roles";
import type { ScheduleEvent, ScheduleNotificationInstance } from "./types";
import { isPreparedScheduleDeliveryTextUsable } from "./preparation";
import { allNotificationsSent, getCurrentOccurrence, listNotificationInstances } from "./schedule";
import { readScheduleEvents, writeScheduleEvents } from "./store";

function fallbackDeliveryMessage(_config: AppConfig, event: ScheduleEvent, instance: ScheduleNotificationInstance, locale: Locale): string {
  let label = event.title;
  if (instance.label) {
    label = `${event.title}（${instance.label}）`;
  } else if (instance.offsetMinutes < 0) {
    label = `${event.title}（提前${Math.abs(instance.offsetMinutes)}分钟）`;
  } else if (instance.offsetMinutes > 0) {
    label = `${event.title}（${instance.offsetMinutes}分钟后）`;
  }
  return tForLocale(locale, "schedule_delivery", { text: label });
}

function markNotificationSent(event: ScheduleEvent, notificationId: string): void {
  const current = event.deliveryState?.currentOccurrence;
  if (!current) return;
  if (!current.sentNotificationIds.includes(notificationId)) {
    current.sentNotificationIds.push(notificationId);
  }
}

function ensureOccurrenceState(event: ScheduleEvent, now: Date): ScheduleEvent | null {
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

function advanceOccurrence(event: ScheduleEvent, now: Date): void {
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

function scheduleTargets(config: AppConfig, event: ScheduleEvent): number[] {
  const targets = event.targets
    .map((item) => item.targetId)
    .filter((item) => Number.isInteger(item));
  return targets.length > 0 ? Array.from(new Set(targets)) : listAuthorizedUserIds(config);
}

export async function deliverDueSchedules(
  config: AppConfig,
  bot: Bot<Context>,
  renderMessage?: (event: ScheduleEvent, instance: ScheduleNotificationInstance, fallback: string) => Promise<string>,
  afterDelivery?: (event: ScheduleEvent, instance: ScheduleNotificationInstance) => Promise<void>,
): Promise<number> {
  const events = await readScheduleEvents(config);
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
      const preparedMessage = activeEvent.category === "scheduled-task"
        ? undefined
        : isPreparedScheduleDeliveryTextUsable(activeEvent, instance) ? activeEvent.deliveryText : undefined;
      const targets = scheduleTargets(config, activeEvent);
      let delivered = false;
      for (const targetId of targets) {
        const locale = targetId > 0 ? userLocale(config, targetId) : config.bot.language;
        const fallbackMessage = fallbackDeliveryMessage(config, activeEvent, instance, locale);
        let deliveryMessage = preparedMessage || fallbackMessage;
        if (!preparedMessage && renderMessage) {
          try {
            deliveryMessage = await renderMessage(activeEvent, instance, fallbackMessage);
          } catch (error) {
            await logger.warn(`schedule render fallback event=${activeEvent.id} notification=${instance.notificationId} error=${error instanceof Error ? error.message : String(error)}`);
            deliveryMessage = fallbackMessage;
          }
        }
        try {
          await logger.info(`schedule delivery attempt event=${activeEvent.id} title=${JSON.stringify(activeEvent.title)} target=${targetId} notification=${instance.notificationId} notifyAt=${instance.notifyAt} chars=${deliveryMessage.length}`);
          await sendMessageFormatted(bot, targetId, deliveryMessage);
          await logger.info(`schedule delivery sent event=${activeEvent.id} title=${JSON.stringify(activeEvent.title)} target=${targetId} notification=${instance.notificationId}`);
          delivered = true;
        } catch (error) {
          await logger.warn(`failed to deliver schedule ${activeEvent.id} to target=${targetId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!delivered) continue;
      markNotificationSent(activeEvent, instance.notificationId);
      activeEvent.updatedAt = now.toISOString();
      activeEvent.deliveryText = undefined;
      activeEvent.deliveryTextGeneratedAt = undefined;
      activeEvent.deliveryPreparedNotificationId = undefined;
      activeEvent.deliveryPreparedNotifyAt = undefined;
      if (afterDelivery) await afterDelivery(activeEvent, instance);
      sent += 1;
      changed = true;
    }

    if (allNotificationsSent(activeEvent)) {
      advanceOccurrence(activeEvent, now);
      changed = true;
    }
  }

  if (changed) await writeScheduleEvents(config, events);
  return sent;
}

export async function startScheduleLoop(
  config: AppConfig,
  bot: Bot<Context>,
  renderMessage?: (event: ScheduleEvent, instance: ScheduleNotificationInstance, fallback: string) => Promise<string>,
  afterDelivery?: (event: ScheduleEvent, instance: ScheduleNotificationInstance) => Promise<void>,
): Promise<NodeJS.Timeout> {
  let running = false;
  return setInterval(async () => {
    if (running) {
      await logger.warn("skipping schedule tick because previous delivery is still running");
      return;
    }
    running = true;
    try {
      const sent = await deliverDueSchedules(config, bot, renderMessage, afterDelivery);
      if (sent > 0) await logger.info(`sent ${sent} schedules`);
    } catch (error) {
      await logger.error(`schedule loop failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  }, 30000);
}
