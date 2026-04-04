import { getReminderEvent, updateReminderEvent } from "operations/reminders";
import { prepareReminderDeliveryText } from "operations/reminders/preparation";
import { runReminderTask } from "operations/reminders/task-actions";
import type { TaskHandler } from "./types";
import { readTrimmedPayloadString } from "./shared";

async function runReminderPreparationTaskHandler(
  context: Parameters<TaskHandler["run"]>[0],
  task: Parameters<TaskHandler["run"]>[1],
): Promise<{ result?: Record<string, unknown> }> {
  const reminderId = readTrimmedPayloadString(task, "reminderId") || task.subject?.id || "";
  if (!reminderId) return { result: { skipped: true, reason: "missing-reminder-id" } };
  const event = await getReminderEvent(context.config, reminderId);
  if (!event) return { result: { skipped: true, reason: "missing-reminder" } };
  const changed = await prepareReminderDeliveryText(context.config, context.agentService, event);
  if (changed) await updateReminderEvent(context.config, event);
  return { result: { changed, reminderId } };
}

export const reminderPreparationTaskHandler: TaskHandler = {
  name: "reminders.prepare-delivery-text",
  supports: (task) => task.domain === "reminders" && task.operation === "prepare-delivery-text",
  run: runReminderPreparationTaskHandler,
};

export const remindersTaskHandler: TaskHandler = {
  name: "reminders",
  supports: (task) => task.domain === "reminders",
  run: async (context, task) => ({ result: await runReminderTask(context.config, task) }),
};
