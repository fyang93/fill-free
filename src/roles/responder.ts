import type { Context } from "grammy";
import type { AppConfig, AiAttachment, UploadedFile } from "scheduling/app/types";
import type { AiService } from "support/ai";
import { logger } from "scheduling/app/logger";
import { t } from "scheduling/app/i18n";
import { editMessageTextFormatted } from "interaction/telegram/format";
import { executeAiActions, type ActionExecutionResult, type ExecuteAiActionsInput } from "./executor";
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
  messageTime?: string;
}): Promise<{ responderContextText: string; requesterTimezone: string | null; hasIndexedContext: boolean }> {
  const indexContext = await lookupResponderIndexContext(config, input.promptText);
  if (indexContext.matchedTerms.length > 0) {
    await touchInvertedIndexTerms(config.paths.repoRoot, indexContext.matchedTerms);
  }
  const responderContextText = await buildResponderContextBlock(config, {
    requesterUserId: input.requesterUserId,
    chatId: input.chatId,
    messageTime: input.messageTime,
    indexContext,
  });
  return {
    responderContextText,
    requesterTimezone: lookupRequesterTimezone(config, input.requesterUserId),
    hasIndexedContext: indexContext.paths.length > 0,
  };
}

export async function publishResponderFirstReply(ctx: Context, task: ActiveConversationTask, message: string): Promise<void> {
  await ctx.reply(message);
  if (typeof task.waitingMessageId === "number") {
    await ctx.api.deleteMessage(task.chatId, task.waitingMessageId).catch(() => {});
  }
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

type LaneResult =
  | { lane: "fast"; responderMs: number; answer: Awaited<ReturnType<AiService["prompt"]>> }
  | { lane: "slow"; executorMs: number; result: ActionExecutionResult };

function normalizeReply(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function publishVisibleReply(
  ctx: Context,
  task: ActiveConversationTask,
  message: string,
  state: { sentFirstReply: boolean; releasedActiveTask: boolean },
  onReleaseActiveTask: (scopeKey: string, taskId: number) => void,
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) return;
  if (!state.sentFirstReply) {
    await publishResponderFirstReply(ctx, task, trimmed);
    state.sentFirstReply = true;
    if (!state.releasedActiveTask) {
      onReleaseActiveTask(task.scopeKey, task.id);
      state.releasedActiveTask = true;
    }
    return;
  }
  await ctx.reply(trimmed);
}

// Fast lane: responder with narrow context.
// Slow lane: executor planning/execution that can also produce the final user-visible reply.
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
  const publishState = { sentFirstReply: false, releasedActiveTask: false };

  try {
    const { responderContextText, requesterTimezone, hasIndexedContext } = await prepareResponderContext(config, {
      requesterUserId: userId,
      chatId: task.chatId,
      promptText,
      messageTime,
    });
    await logger.info(`conversation task ${task.id} role=race state=start scope=${JSON.stringify(task.scopeKey)} accessRole=${accessRole} uploadedFiles=${uploadedFiles.length} attachments=${attachments.length} promptChars=${effectivePromptText.length}`);

    const fastStartedAt = Date.now();
    const fastPromise: Promise<LaneResult> = agentService.prompt(
      effectivePromptText,
      uploadedFiles,
      attachments,
      messageTime,
      task.scopeKey,
      task.scopeLabel,
      accessRole,
      responderContextText,
      requesterTimezone,
    ).then((answer) => ({ lane: "fast" as const, responderMs: Date.now() - fastStartedAt, answer }));

    const slowStartedAt = Date.now();
    const slowPromise: Promise<LaneResult> = executeAiActions({
      config,
      agentService,
      ctx,
      requesterUserId: userId,
      messageTime,
      requesterTimezone,
      canDeliverOutbound: isTrustedUserId(userId) || isAdminUserId(userId),
      accessRole,
      userRequestText: promptText,
      responderContextText,
      isTaskCurrent: () => !task.cancelled,
    } satisfies ExecuteAiActionsInput).then((result) => ({ lane: "slow" as const, executorMs: Date.now() - slowStartedAt, result }));
    void fastPromise.catch(() => {});
    void slowPromise.catch(() => {});

    let fastResult: Awaited<typeof fastPromise> | null = null;
    let slowResult: Awaited<typeof slowPromise> | null = null;
    let firstPublishedText = "";
    let executorMs = 0;
    let responderMs = 0;

    const firstLane = await Promise.race([fastPromise, slowPromise]);

    if (task.cancelled || !isTaskCurrent(task.scopeKey, task.id)) {
      await logger.warn(`discarding stale conversation result for task ${task.id}`);
      return;
    }

    onStopWaiting(task);

    if (firstLane.lane === "fast") {
      fastResult = firstLane;
      responderMs = firstLane.responderMs;
      const answer = firstLane.answer;
      await logger.info(`conversation task ${task.id} role=responder source=model indexedContext=${hasIndexedContext ? "yes" : "no"}`);
      await logger.info(`conversation task ${task.id} role=responder state=done ms=${responderMs} answerMode=${answer.answerMode} messageChars=${answer.message.length} files=${answer.files.length} reminders=${answer.reminders.length} deliveries=${answer.deliveries.length} pendingAuthorizations=${answer.pendingAuthorizations.length} tasks=${answer.tasks.length}`);

      const responderMessage = answer.message.trim() || t(config, "generic_done");
      if (answer.answerMode === "needs-clarification") {
        rememberRecentClarification(task.scopeKey, promptText, responderMessage);
      } else {
        clearRecentClarification(task.scopeKey);
      }

      await publishVisibleReply(ctx, task, responderMessage, publishState, onReleaseActiveTask);
      firstPublishedText = responderMessage;
      await deliverAiOutputs(ctx, config, answer);

      if (answer.answerMode !== "needs-execution") {
        await logger.info(`conversation task ${task.id} role=slow state=ignored reason=${answer.answerMode}`);
        await onPruneRecentUploads(task.scopeKey);
        await onSetReaction(ctx, "🥰");
        await logger.info(`conversation task ${task.id} completed totalMs=${Date.now() - taskStartedAt} responderMs=${responderMs} executorMs=0 outputMs=0 mode=${answer.answerMode}`);
        return;
      }

      slowResult = await slowPromise;
    } else {
      slowResult = firstLane;
      executorMs = firstLane.executorMs;
      const result = firstLane.result;
      await logger.info(`conversation task ${task.id} role=slow state=done-first ms=${executorMs} answerMode=${result.answerMode} messageChars=${result.message.length} facts=${result.facts.length}`);

      clearRecentClarification(task.scopeKey);
      if (result.answerMode === "needs-clarification") {
        rememberRecentClarification(task.scopeKey, promptText, result.message.trim());
      }

      await publishVisibleReply(ctx, task, result.message.trim() || t(config, "generic_done"), publishState, onReleaseActiveTask);
      firstPublishedText = result.message.trim() || t(config, "generic_done");

      if (result.answerMode !== "needs-execution") {
        await logger.info(`conversation task ${task.id} role=responder state=ignored reason=slow-${result.answerMode}`);
        await onPruneRecentUploads(task.scopeKey);
        await onSetReaction(ctx, "🥰");
        await logger.info(`conversation task ${task.id} completed totalMs=${Date.now() - taskStartedAt} responderMs=0 executorMs=${executorMs} outputMs=0 mode=${result.answerMode}`);
        return;
      }

    }

    const finalSlowResult = slowResult || await slowPromise;
    if (finalSlowResult.lane !== "slow") {
      throw new Error("Race protocol violation: expected slow-lane result.");
    }
    executorMs = finalSlowResult.executorMs;
    const slowMessage = finalSlowResult.result.message.trim();
    await logger.info(`conversation task ${task.id} role=slow state=done ms=${executorMs} answerMode=${finalSlowResult.result.answerMode} messageChars=${slowMessage.length} facts=${finalSlowResult.result.facts.length}`);

    if (task.cancelled) {
      await logger.warn(`skipping stale slow-lane completion for task ${task.id}`);
      return;
    }

    if (finalSlowResult.result.answerMode === "needs-clarification") {
      rememberRecentClarification(task.scopeKey, promptText, slowMessage);
    } else {
      clearRecentClarification(task.scopeKey);
    }

    if (slowMessage && normalizeReply(slowMessage) !== normalizeReply(firstPublishedText)) {
      await publishVisibleReply(ctx, task, slowMessage, publishState, onReleaseActiveTask);
    }

    await onPruneRecentUploads(task.scopeKey);
    await onSetReaction(ctx, "🥰");
    await logger.info(`conversation task ${task.id} completed totalMs=${Date.now() - taskStartedAt} responderMs=${responderMs} executorMs=${executorMs} outputMs=0 mode=needs-execution`);
  } catch (error) {
    if (task.cancelled) {
      await logger.warn(`ignored conversation failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    onStopWaiting(task);
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`conversation handling failed: ${message}`);
    await onPruneRecentUploads(task.scopeKey);
    const failureText = t(config, "task_failed", { error: message });
    if (typeof task.waitingMessageId === "number" && !publishState.sentFirstReply) {
      await editMessageTextFormatted(ctx, task.chatId, task.waitingMessageId, failureText);
    } else {
      await ctx.reply(failureText);
    }
    await onSetReaction(ctx, "😞");
  } finally {
    onStopWaiting(task);
  }
}
