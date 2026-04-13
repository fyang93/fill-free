import type { TaskHandler, TaskHandlerContext, TaskHandlerResult } from "./types";
import type { TaskRecord } from "../store";
import { schedulePreparationTaskHandler, schedulesTaskHandler } from "bot/operations/schedules";
import { messagesDeliverTaskHandler } from "./messages";
import { accessGrantTemporaryTaskHandler, accessSetRoleTaskHandler } from "bot/operations/access";

const taskHandlers: TaskHandler[] = [
  schedulePreparationTaskHandler,
  schedulesTaskHandler,
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
