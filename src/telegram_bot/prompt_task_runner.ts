import type { Context } from "grammy";
import type { AppConfig, PromptAttachment, UploadedFile } from "./types";
import type { OpenCodeService, PromptResult } from "./opencode";
import { logger } from "./logger";
import { t } from "./i18n";
import { editMessageTextFormatted } from "./telegram_format";
import { executePromptActions, type ExecutePromptActionsInput } from "./prompt_actions";
import type { Bot } from "grammy";
import { buildTelegramPromptContext } from "./telegram_identity";
import { deliverPromptOutputs } from "./prompt_task_runtime";

export type ActivePromptTask = {
  id: number;
  userId?: number;
  scopeKey: string;
  scopeLabel: string;
  chatId: number;
  sourceMessageId: number;
  waitingMessageId: number;
  cancelled: boolean;
  waitingMessageRotation?: NodeJS.Timeout;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export type RunPromptTaskDeps = {
  config: AppConfig;
  bot: Bot<Context>;
  ctx: Context;
  task: ActivePromptTask;
  promptText: string;
  uploadedFiles: UploadedFile[];
  attachments: PromptAttachment[];
  telegramMessageTime?: string;
  opencode: OpenCodeService;
  isAdminUserId: (userId: number | undefined) => boolean;
  isTrustedUserId: (userId: number | undefined) => boolean;
  isTaskCurrent: (scopeKey: string, taskId: number) => boolean;
  onPruneRecentUploads: (scopeKey: string) => Promise<void>;
  onStopWaiting: (task: ActivePromptTask) => void;
  onSetReaction: (ctx: Context, emoji: string) => Promise<void>;
};

export async function runPromptTask(deps: RunPromptTaskDeps): Promise<void> {
  const {
    config,
    ctx,
    task,
    promptText,
    uploadedFiles,
    attachments,
    telegramMessageTime,
    opencode,
    isAdminUserId,
    isTrustedUserId,
    isTaskCurrent,
    onPruneRecentUploads,
    onStopWaiting,
    onSetReaction,
  } = deps;

  const userId = task.userId;
  const accessRole = isAdminUserId(userId) ? "admin" : isTrustedUserId(userId) ? "trusted" : "allowed";
  const telegramPromptContext = buildTelegramPromptContext(config, ctx);
  const effectivePromptText = telegramPromptContext ? `${promptText}\n\n${telegramPromptContext}` : promptText;
  const promptStartedAt = Date.now();

  try {
    const answer = await withTimeout(
      opencode.prompt(effectivePromptText, uploadedFiles, attachments, telegramMessageTime, task.scopeKey, task.scopeLabel, accessRole),
      config.bot.promptTaskTimeoutMs,
      `prompt task ${task.id}`,
    );
    await logger.info(`prompt task ${task.id} completed in ${Date.now() - promptStartedAt}ms`);
    if (task.cancelled || !isTaskCurrent(task.scopeKey, task.id)) {
      await logger.warn(`discarding stale prompt result for task ${task.id}`);
      return;
    }

    onStopWaiting(task);
    const actionResult = await executePromptActions({
      config,
      bot: deps.bot,
      opencode,
      answer,
      ctx,
      requesterUserId: userId,
      telegramMessageTime,
      canDeliverOutbound: isTrustedUserId(userId) || isAdminUserId(userId),
      accessRole,
    } satisfies ExecutePromptActionsInput);
    const finalMessage = await composeFinalReply({
      config,
      opencode,
      answer,
      actionResult,
    });
    await editMessageTextFormatted(ctx, task.chatId, task.waitingMessageId, finalMessage);

    await deliverPromptOutputs(ctx, config, answer);
    await onPruneRecentUploads(task.scopeKey);
    await onSetReaction(ctx, "🥰");
  } catch (error) {
    if (task.cancelled || !isTaskCurrent(task.scopeKey, task.id)) {
      await logger.warn(`ignored prompt failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    onStopWaiting(task);
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out after/i.test(message)) {
      await logger.warn(`prompt task ${task.id} timed out; aborting opencode session for ${task.scopeLabel}`);
      await opencode.abortCurrentSession(task.scopeKey, task.scopeLabel);
    }
    await logger.error(`prompt handling failed: ${message}`);
    await onPruneRecentUploads(task.scopeKey);
    await editMessageTextFormatted(ctx, task.chatId, task.waitingMessageId, t(config, "task_failed", { error: message }));
    await onSetReaction(ctx, "😞");
  } finally {
    onStopWaiting(task);
  }
}

async function composeFinalReply(input: {
  config: AppConfig;
  opencode: OpenCodeService;
  answer: PromptResult;
  actionResult: Awaited<ReturnType<typeof executePromptActions>>;
}): Promise<string> {
  const { config, opencode, answer, actionResult } = input;
  const modelFacts = actionResult.facts;
  let finalMessage = answer.message || t(config, "generic_done");
  if (modelFacts.length > 0) {
    try {
      finalMessage = await opencode.composeTelegramReply(finalMessage, modelFacts);
    } catch (error) {
      await logger.warn(`failed to compose telegram follow-up reply: ${error instanceof Error ? error.message : String(error)}`);
      finalMessage = [finalMessage, ...modelFacts].filter(Boolean).join("\n\n");
    }
  }
  if (actionResult.replyAppendix) {
    finalMessage = [finalMessage, actionResult.replyAppendix].filter(Boolean).join("\n\n");
  }
  return finalMessage;
}
