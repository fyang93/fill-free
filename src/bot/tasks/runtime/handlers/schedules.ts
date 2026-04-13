import type { ScheduleEvent } from "bot/operations/schedules";
import { getScheduleEvent, updateScheduleEvent } from "bot/operations/schedules";
import { prepareScheduleDeliveryText } from "bot/operations/schedules/preparation";
import { runScheduleTask } from "bot/operations/schedules/task-actions";
import type { TaskHandler } from "./types";
import { readTrimmedPayloadString } from "./shared";

function schedulePreparationFingerprint(event: ScheduleEvent): string {
  return JSON.stringify({
    title: event.title,
    note: event.note,
    category: event.category,
    specialKind: event.specialKind,
    timeSemantics: event.timeSemantics,
    timezone: event.timezone,
    schedule: event.schedule,
    notifications: event.notifications,
    targets: event.targets,
    status: event.status,
    currentOccurrenceScheduledAt: event.deliveryState?.currentOccurrence?.scheduledAt,
    sentNotificationIds: event.deliveryState?.currentOccurrence?.sentNotificationIds || [],
  });
}

async function runSchedulePreparationTaskHandler(
  context: Parameters<TaskHandler["run"]>[0],
  task: Parameters<TaskHandler["run"]>[1],
): Promise<{ result?: Record<string, unknown> }> {
  const scheduleId = readTrimmedPayloadString(task, "scheduleId") || task.subject?.id || "";
  if (!scheduleId) return { result: { skipped: true, reason: "missing-schedule-id" } };
  const event = await getScheduleEvent(context.config, scheduleId);
  if (!event) return { result: { skipped: true, reason: "missing-schedule" } };
  const fingerprintBefore = schedulePreparationFingerprint(event);
  const changed = await prepareScheduleDeliveryText(context.config, context.agentService, event);
  if (!changed) return { result: { changed, scheduleId } };

  const latest = await getScheduleEvent(context.config, scheduleId);
  if (!latest) return { result: { skipped: true, reason: "missing-schedule-after-prepare" } };
  if (schedulePreparationFingerprint(latest) !== fingerprintBefore) {
    return { result: { changed: false, scheduleId, skipped: true, reason: "schedule-changed-during-prepare" } };
  }

  latest.deliveryText = event.deliveryText;
  latest.deliveryTextGeneratedAt = event.deliveryTextGeneratedAt;
  latest.deliveryPreparedNotificationId = event.deliveryPreparedNotificationId;
  latest.deliveryPreparedNotifyAt = event.deliveryPreparedNotifyAt;
  await updateScheduleEvent(context.config, latest);
  return { result: { changed, scheduleId } };
}

export const schedulePreparationTaskHandler: TaskHandler = {
  name: "schedules.prepare-delivery-text",
  supports: (task) => task.domain === "schedules" && task.operation === "prepare-delivery-text",
  run: runSchedulePreparationTaskHandler,
};

export const schedulesTaskHandler: TaskHandler = {
  name: "schedules",
  supports: (task) => task.domain === "schedules",
  run: async (context, task) => ({ result: await runScheduleTask(context.config, task) }),
};
