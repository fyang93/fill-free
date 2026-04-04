import type { Bot, Context } from "grammy";
import type { AppConfig } from "scheduling/app/types";
import type { AiService } from "support/ai";
import type { TaskRecord } from "../store";

export type TaskHandlerResult = { result?: Record<string, unknown> };

export type TaskHandlerContext = {
  config: AppConfig;
  agentService: AiService;
  bot: Bot<Context>;
};

export type TaskHandler = {
  name: string;
  supports: (task: TaskRecord) => boolean;
  run: (context: TaskHandlerContext, task: TaskRecord) => Promise<TaskHandlerResult>;
};
