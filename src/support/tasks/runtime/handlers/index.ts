import type { TaskHandler, TaskHandlerContext, TaskHandlerResult } from "./types";
import type { TaskRecord } from "../store";
import { reminderPreparationTaskHandler, remindersTaskHandler } from "operations/reminders";
import { messagesDeliverTaskHandler } from "./messages";
import { accessGrantTemporaryTaskHandler, accessSetRoleTaskHandler } from "operations/access";
import { queryAnswerFromRepoTaskHandler } from "operations/query";
import { rulesTaskHandler } from "./rules";

const taskHandlers: TaskHandler[] = [
  reminderPreparationTaskHandler,
  remindersTaskHandler,
  messagesDeliverTaskHandler,
  accessGrantTemporaryTaskHandler,
  accessSetRoleTaskHandler,
  queryAnswerFromRepoTaskHandler,
  rulesTaskHandler,
];

export function getTaskHandlers(): TaskHandler[] {
  return taskHandlers;
}

export async function runTaskWithHandlers(context: TaskHandlerContext, task: TaskRecord): Promise<TaskHandlerResult> {
  const handler = taskHandlers.find((item) => item.supports(task));
  if (!handler) return { result: { skipped: true, reason: "unsupported-task" } };
  return handler.run(context, task);
}
