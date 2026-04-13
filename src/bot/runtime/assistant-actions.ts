import type { Context } from "grammy";
import { logger } from "bot/app/logger";
import type { AiService } from "bot/ai";
import type { RequestAccessRole } from "bot/ai/prompt";
import type { AiTurnResult, AssistantProgressHandler } from "bot/ai/types";
import type { AiAttachment, AppConfig } from "bot/app/types";

export type AssistantTurnResult = {
  message: string;
  files: string[];
  attachments: AiAttachment[];
  facts: string[];
  hasSideEffectfulActions: boolean;
  completedActions: string[];
};

export type ExecuteAssistantActionsInput = {
  config: AppConfig;
  agentService: AiService;
  answer?: AiTurnResult;
  ctx: Context;
  requesterUserId?: number;
  attachments?: AiAttachment[];
  messageTime?: string;
  requesterTimezone?: string | null;
  canDeliverOutbound: boolean;
  accessRole: RequestAccessRole;
  userRequestText: string;
  sharedConversationContextText?: string;
  scopeKey?: string;
  scopeLabel?: string;
  isTaskCurrent?: () => boolean;
  onProgress?: AssistantProgressHandler;
};

export async function executeAssistantActions(input: ExecuteAssistantActionsInput): Promise<AssistantTurnResult> {
  const assistantStartedAt = Date.now();
  const taskStillCurrent = () => (input.isTaskCurrent ? input.isTaskCurrent() : true);

  const planned = await input.agentService.runAssistantTurn({
    userRequestText: input.userRequestText,
    requesterUserId: input.requesterUserId,
    chatId: input.ctx.chat?.id,
    chatType: input.ctx.chat?.type,
    accessRole: input.accessRole,
    attachments: input.attachments || [],
    messageTime: input.messageTime,
    requesterTimezone: input.requesterTimezone,
    sharedConversationContextText: input.sharedConversationContextText,
    scopeKey: input.scopeKey,
    scopeLabel: input.scopeLabel,
    isTaskCurrent: taskStillCurrent,
    onProgress: input.onProgress,
  });

  if (!taskStillCurrent()) {
    await logger.warn("assistant agent result ignored because task is stale");
    return { message: "", files: [], attachments: [], facts: [], hasSideEffectfulActions: false, completedActions: planned.completedActions || [] };
  }

  await logger.info(`assistant agent actions interpreted usedNativeExecution=${planned.usedNativeExecution ? "yes" : "no"} actions=${JSON.stringify(planned.completedActions)}`);

  if (!planned.usedNativeExecution) {
    await logger.warn(`assistant agent completed without recognized execution parts rawMessage=${JSON.stringify(planned.message)}`);
  }

  const message = planned.message.trim();
  const files = Array.isArray(planned.files) ? planned.files : [];
  const attachments = Array.isArray(planned.attachments) ? planned.attachments : [];
  await logger.info(`assistant agent total ms=${Date.now() - assistantStartedAt} sideEffects=native-execution actions=${JSON.stringify(planned.completedActions)}`);
  return {
    message,
    files,
    attachments,
    facts: [],
    hasSideEffectfulActions: true,
    completedActions: planned.completedActions || [],
  };
}

export type ActionExecutionResult = AssistantTurnResult;
