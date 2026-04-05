import type { Context } from "grammy";
import type { AppConfig, AiAttachment, UploadedFile } from "scheduling/app/types";
import type { AiService } from "support/ai";
import { logger } from "scheduling/app/logger";
import { t } from "scheduling/app/i18n";
import { editMessageTextFormatted } from "interaction/telegram/format";
import { executeAiActions, type ExecuteAiActionsInput } from "./executor";
import { buildTelegramRequestContext } from "interaction/telegram/identity";
import { deliverAiOutputs } from "scheduling/conversations/output";
import { buildResponderContextBlock, lookupRequesterTimezone, lookupResponderIndexContext } from "operations/context/responder";
import { touchInvertedIndexTerms } from "operations/context/inverted-index";
import { clearRecentClarification, rememberRecentClarification } from "scheduling/app/state";

export type ActiveConversationTask = {
  id: number;
  userId?: number;
  scopeKey: string;
  scopeLabel: string;
  chatId: number;
  sourceMessageId: number;
  waitingMessageId?: number;
  cancelled: boolean;
  waitingMessageRotation?: NodeJS.Timeout;
};

async function prepareResponderContext(config: AppConfig, input: {
  requesterUserId?: number;
  chatId: number;
  promptText: string;
}): Promise<{ responderContextText: string; requesterTimezone: string | null; hasIndexedContext: boolean }> {
  const indexContext = await lookupResponderIndexContext(config, input.promptText);
  if (indexContext.matchedTerms.length > 0) {
    await touchInvertedIndexTerms(config.paths.repoRoot, indexContext.matchedTerms);
  }
  const responderContextText = await buildResponderContextBlock(config, {
    requesterUserId: input.requesterUserId,
    chatId: input.chatId,
    indexContext,
  });
  return {
    responderContextText,
    requesterTimezone: lookupRequesterTimezone(config, input.requesterUserId),
    hasIndexedContext: indexContext.paths.length > 0,
  };
}

export type RunConversationTaskDeps = {
  config: AppConfig;
  ctx: Context;
  task: ActiveConversationTask;
  promptText: string;
  uploadedFiles: UploadedFile[];
  attachments: AiAttachment[];
  messageTime?: string;
  agentService: AiService;
  isAdminUserId: (userId: number | undefined) => boolean;
  isTrustedUserId: (userId: number | undefined) => boolean;
  isTaskCurrent: (scopeKey: string, taskId: number) => boolean;
  onPruneRecentUploads: (scopeKey: string) => Promise<void>;
  onStopWaiting: (task: ActiveConversationTask) => void;
  onSetReaction: (ctx: Context, emoji: string) => Promise<void>;
  onReleaseActiveTask: (scopeKey: string, taskId: number) => void;
};

// Responder role: obtain the model result and produce the user-facing reply.
// Executor role: durably accept and perform deterministic actions after the model result is available.
export async function runConversationTask(deps: RunConversationTaskDeps): Promise<void> {
  const {
    config,
    ctx,
    task,
    promptText,
    uploadedFiles,
    attachments,
    messageTime,
    agentService,
    isAdminUserId,
    isTrustedUserId,
    isTaskCurrent,
    onPruneRecentUploads,
    onStopWaiting,
    onSetReaction,
    onReleaseActiveTask,
  } = deps;

  const userId = task.userId;
  const accessRole = isAdminUserId(userId) ? "admin" : isTrustedUserId(userId) ? "trusted" : "allowed";
  const telegramRequestContext = buildTelegramRequestContext(config, ctx);
  const effectivePromptText = telegramRequestContext ? `${promptText}\n\n${telegramRequestContext}` : promptText;
  const taskStartedAt = Date.now();
  const responderStartedAt = taskStartedAt;

  try {
    const { responderContextText, requesterTimezone, hasIndexedContext } = await prepareResponderContext(config, {
      requesterUserId: userId,
      chatId: task.chatId,
      promptText,
    });
    await logger.info(`conversation task ${task.id} role=responder state=start scope=${JSON.stringify(task.scopeKey)} accessRole=${accessRole} uploadedFiles=${uploadedFiles.length} attachments=${attachments.length} promptChars=${effectivePromptText.length}`);
    const answer = await agentService.prompt(
      effectivePromptText,
      uploadedFiles,
      attachments,
      messageTime,
      task.scopeKey,
      task.scopeLabel,
      accessRole,
      responderContextText,
      requesterTimezone,
    );
    const responderMs = Date.now() - responderStartedAt;
    await logger.info(`conversation task ${task.id} role=responder source=model indexedContext=${hasIndexedContext ? "yes" : "no"}`);
    await logger.info(`conversation task ${task.id} role=responder state=done ms=${responderMs} answerMode=${answer.answerMode} messageChars=${answer.message.length} files=${answer.files.length} reminders=${answer.reminders.length} outboundMessages=${answer.outboundMessages.length} pendingAuthorizations=${answer.pendingAuthorizations.length} tasks=${answer.tasks.length}`);
    if (task.cancelled || !isTaskCurrent(task.scopeKey, task.id)) {
      await logger.warn(`discarding stale conversation result for task ${task.id}`);
      return;
    }

    onStopWaiting(task);
    const responderMessage = answer.message.trim() || t(config, "generic_done");
    if (answer.answerMode === "needs-clarification") {
      rememberRecentClarification(task.scopeKey, promptText, responderMessage);
    } else {
      clearRecentClarification(task.scopeKey);
    }
    if (typeof task.waitingMessageId === "number") {
      await editMessageTextFormatted(ctx, task.chatId, task.waitingMessageId, responderMessage);
    } else {
      await ctx.reply(responderMessage);
    }
    onReleaseActiveTask(task.scopeKey, task.id);

    let executorMs = 0;
    let callbackMs = 0;
    if (answer.answerMode === "needs-execution") {
      const executorStartedAt = Date.now();
      await logger.info(`conversation task ${task.id} role=executor state=start`);
      const actionResult = await executeAiActions({
        config,
        agentService,
        answer,
        ctx,
        requesterUserId: userId,
        messageTime,
        canDeliverOutbound: isTrustedUserId(userId) || isAdminUserId(userId),
        accessRole,
        userRequestText: promptText,
        responderContextText,
        isTaskCurrent: () => !task.cancelled,
      } satisfies ExecuteAiActionsInput);
      executorMs = Date.now() - executorStartedAt;
      await logger.info(`conversation task ${task.id} role=executor state=done ms=${executorMs} facts=${actionResult.facts.length}`);

      if (task.cancelled) {
        await logger.warn(`skipping stale post-executor callback for task ${task.id}`);
        return;
      }

      const callbackStartedAt = Date.now();
      await logger.info(`conversation task ${task.id} role=responder-callback state=start`);
      const rawCallbackMessage = actionResult.facts.length > 0
        ? await agentService.composeExecutionCallbackReply(
          responderMessage,
          actionResult.facts,
          {
            requesterUserId: userId,
            chatId: task.chatId,
            chatType: ctx.chat?.type,
          },
        )
        : !actionResult.hasSideEffectfulActions && actionResult.message.trim() && actionResult.message.trim() !== responderMessage.trim()
          ? actionResult.message.trim()
          : "";
      const normalizedResponderMessage = responderMessage.replace(/\s+/g, " ").trim();
      const normalizedCallbackMessage = rawCallbackMessage.replace(/\s+/g, " ").trim();
      const callbackMessage = normalizedCallbackMessage && normalizedCallbackMessage !== normalizedResponderMessage
        ? rawCallbackMessage.trim()
        : "";
      callbackMs = Date.now() - callbackStartedAt;
      await logger.info(`conversation task ${task.id} role=responder-callback state=done ms=${callbackMs} finalChars=${callbackMessage.length} enabled=${callbackMessage.trim() ? "yes" : "no"}`);
      if (callbackMessage.trim()) {
        await ctx.reply(callbackMessage);
      }
    } else {
      const skipReason = answer.answerMode === "needs-clarification" ? "needs-clarification" : "direct-answer";
      await logger.info(`conversation task ${task.id} role=executor state=skipped reason=${skipReason}`);
    }

    const outputStartedAt = Date.now();
    await deliverAiOutputs(ctx, config, answer);
    const outputMs = Date.now() - outputStartedAt;
    await onPruneRecentUploads(task.scopeKey);
    await onSetReaction(ctx, "🥰");
    await logger.info(`conversation task ${task.id} completed totalMs=${Date.now() - taskStartedAt} responderMs=${responderMs} executorMs=${executorMs} callbackMs=${callbackMs} outputMs=${outputMs}`);
  } catch (error) {
    if (task.cancelled) {
      await logger.warn(`ignored conversation failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    onStopWaiting(task);
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`conversation handling failed: ${message}`);
    await onPruneRecentUploads(task.scopeKey);
    if (typeof task.waitingMessageId === "number") {
      await editMessageTextFormatted(ctx, task.chatId, task.waitingMessageId, t(config, "task_failed", { error: message }));
    } else {
      await ctx.reply(t(config, "task_failed", { error: message }));
    }
    await onSetReaction(ctx, "😞");
  } finally {
    onStopWaiting(task);
  }
}

