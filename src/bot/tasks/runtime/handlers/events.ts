import type { EventRecord } from "bot/operations/events";
import { getEventRecord, updateEventRecord } from "bot/operations/events";
import { prepareScheduleDeliveryText } from "bot/operations/events/preparation";
import { runEventTask } from "bot/operations/events/task-actions";
import type { TaskHandler } from "./types";
import { readTrimmedPayloadString } from "./shared";

function schedulePreparationFingerprint(event: EventRecord): string {
  return JSON.stringify({
    title: event.title,
    note: event.note,
    category: event.category,
    specialKind: event.specialKind,
    timeSemantics: event.timeSemantics,
    createdByUserId: event.createdByUserId,
    schedule: event.schedule,
    reminders: event.reminders,
    targets: event.targets,
    status: event.status,
    currentOccurrenceScheduledAt: event.deliveryState?.currentOccurrence?.scheduledAt,
    sentReminderIds: event.deliveryState?.currentOccurrence?.sentReminderIds || [],
  });
}

async function runEventPreparationTaskHandler(
  context: Parameters<TaskHandler["run"]>[0],
  task: Parameters<TaskHandler["run"]>[1],
): Promise<{ result?: Record<string, unknown> }> {
  const eventId = readTrimmedPayloadString(task, "eventId") || task.subject?.id || "";
  if (!eventId) return { result: { skipped: true, reason: "missing-event-id" } };
  const event = await getEventRecord(context.config, eventId);
  if (!event) return { result: { skipped: true, reason: "missing-event" } };
  const fingerprintBefore = schedulePreparationFingerprint(event);
  const changed = await prepareScheduleDeliveryText(context.config, context.agentService, event);
  if (!changed) return { result: { changed, eventId } };

  const latest = await getEventRecord(context.config, eventId);
  if (!latest) return { result: { skipped: true, reason: "missing-event-after-prepare" } };
  if (schedulePreparationFingerprint(latest) !== fingerprintBefore) {
    return { result: { changed: false, eventId, skipped: true, reason: "event-changed-during-prepare" } };
  }

  latest.deliveryText = event.deliveryText;
  latest.deliveryTextGeneratedAt = event.deliveryTextGeneratedAt;
  latest.deliveryPreparedReminderId = event.deliveryPreparedReminderId;
  latest.deliveryPreparedNotifyAt = event.deliveryPreparedNotifyAt;
  await updateEventRecord(context.config, latest);
  return { result: { changed, eventId } };
}

export const eventPreparationTaskHandler: TaskHandler = {
  name: "events.prepare-delivery-text",
  supports: (task) => task.domain === "events" && task.operation === "prepare-delivery-text",
  run: runEventPreparationTaskHandler,
};

export const eventsTaskHandler: TaskHandler = {
  name: "events",
  supports: (task) => task.domain === "events",
  run: async (context, task) => ({ result: await runEventTask(context.config, task) }),
};
