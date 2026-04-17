import type { TaskHandler, TaskHandlerContext, TaskHandlerResult } from "./types";
import type { TaskRecord } from "../store";
import { eventPreparationTaskHandler, eventsTaskHandler } from "bot/operations/events";
import { messagesDeliverTaskHandler } from "./messages";
import { accessGrantTemporaryTaskHandler, accessSetRoleTaskHandler } from "bot/operations/access";

const taskHandlers: TaskHandler[] = [
  eventPreparationTaskHandler,
  eventsTaskHandler,
  messagesDeliverTaskHandler,
  accessGrantTemporaryTaskHandler,
  accessSetRoleTaskHandler,
];

export function getTaskHandlers(): TaskHandler[] {
  return taskHandlers;
}

export async function runTaskWithHandlers(context: TaskHandlerContext, task: TaskRecord): Promise<TaskHandlerResult> {
  const handler = taskHandlers.find((item) => item.supports(task));
  if (!handler) return { result: { skipped: true, reason: "unsupported-task" } };
  return handler.run(context, task);
}
