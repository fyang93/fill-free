import type { Bot, Context } from "grammy";
import type { AppConfig } from "scheduling/app/types";
import { logger } from "scheduling/app/logger";
import type { AiService } from "support/ai";
import { dequeueRunnableTask, markTaskState, pruneFinishedTasks, removeTask } from "./store";
import { runTaskWithHandlers } from "./handlers";
import { sendTaskFailureReply, taskLogContext } from "./handlers/shared";

export function startTaskWorker(config: AppConfig, agentService: AiService, bot: Bot<Context>, intervalMs = 15_000): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const pruned = await pruneFinishedTasks(config);
      if (pruned > 0) await logger.info(`pruned ${pruned} finished tasks`);
      while (true) {
        const task = await dequeueRunnableTask(config);
        if (!task) break;
        await logger.info(`task worker start ${taskLogContext(task)}`);
        try {
          const output = await runTaskWithHandlers({ config, agentService, bot }, task);
          await markTaskState(config, task.id, "done", { result: output.result });
          await removeTask(config, task.id);
          await logger.info(`task worker done ${taskLogContext(task)} result=${JSON.stringify(output.result || {})}`);
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
