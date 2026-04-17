import type { Bot, Context } from "grammy";
import type { AppConfig } from "bot/app/types";
import { logger } from "bot/app/logger";
import type { AiService } from "bot/ai";
import { dequeueRunnableTask, failStaleRunningTasks, markTaskState, pruneFinishedTasks, pruneOrphanedEventPreparationTasks, removeTask } from "./store";
import { runTaskWithHandlers } from "./handlers";
import { sendTaskFailureReply, taskLogContext } from "./handlers/shared";

function isQuietNoopTask(task: Awaited<ReturnType<typeof dequeueRunnableTask>>, result?: Record<string, unknown>): boolean {
  if (!task) return false;
  if (task.domain !== "events" || task.operation !== "prepare-delivery-text") return false;
  return result?.changed === false;
}

function shouldLogTaskStart(task: Awaited<ReturnType<typeof dequeueRunnableTask>>): boolean {
  return !(task && task.domain === "events" && task.operation === "prepare-delivery-text");
}

export function startTaskWorker(config: AppConfig, agentService: AiService, bot: Bot<Context>, intervalMs = 15_000): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const recovered = await failStaleRunningTasks(config);
      if (recovered.changed > 0) await logger.warn(`recovered ${recovered.changed} stale running tasks`);
      const orphaned = await pruneOrphanedEventPreparationTasks(config);
      if (orphaned.removed > 0) await logger.info(`pruned ${orphaned.removed} orphaned event preparation tasks`);
      const pruned = await pruneFinishedTasks(config);
      if (pruned.removed > 0) await logger.info(`pruned ${pruned.removed} finished tasks`);
      while (true) {
        const task = await dequeueRunnableTask(config);
        if (!task) break;
        if (shouldLogTaskStart(task)) {
          await logger.info(`task worker start ${taskLogContext(task)}`);
        }
        try {
          const output = await runTaskWithHandlers({ config, agentService, bot }, task);
          await markTaskState(config, task.id, "done", { result: output.result });
          await removeTask(config, task.id);
          if (!isQuietNoopTask(task, output.result)) {
            await logger.info(`task worker done ${taskLogContext(task)} result=${JSON.stringify(output.result || {})}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await markTaskState(config, task.id, "failed", { error: { message } });
          await logger.warn(`task worker failed ${taskLogContext(task)} error=${message}`);
          if (task.source?.chatId) {
            await sendTaskFailureReply(agentService, bot, task, message);
          }
        }
      }
    } finally {
      running = false;
    }
  }, intervalMs);
}
