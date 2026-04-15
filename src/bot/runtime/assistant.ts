import type { Context } from "grammy";
import type { AppConfig, AiAttachment, UploadedFile, WaitingMessageCandidate } from "bot/app/types";
import type { AiService } from "bot/ai";
import { logger } from "bot/app/logger";
import { state, persistState } from "bot/app/state";
import { tForUser } from "bot/app/i18n";
import { editMessageTextFormatted, replyFormatted } from "bot/telegram/format";
import { executeAssistantActions, type ExecuteAssistantActionsInput } from "./assistant-actions";
import { buildTelegramRequestContext } from "bot/telegram/identity";
import { buildAssistantContextBlock, lookupRequesterTimezone } from "bot/operations/context/assistant";
import { accessLevelForUserId, hasAccessLevel } from "bot/operations/access/control";
import { deliverAiOutputs } from "./conversations/output";

const DEFAULT_WAITING_MESSAGE_CANDIDATE_COUNT = 20;

type WaitingMessagePool = WaitingMessageCandidate[];

const waitingMessageCache: {
  key: string | null;
  promise: Promise<WaitingMessagePool> | null;
} = {
  key: null,
  promise: null,
};

let activeWaitingMessagePoolKey: string | null = null;

function waitingMessagePoolKey(config: AppConfig): string {
  return JSON.stringify({ language: config.bot.language, personaStyle: config.bot.personaStyle.trim() });
}

function waitingMessageTargetCount(config: AppConfig): number {
  return Math.max(1, config.telegram.waitingMessageCandidateCount ?? DEFAULT_WAITING_MESSAGE_CANDIDATE_COUNT);
}

function normalizeWaitingMessageText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function dedupeWaitingMessageTexts(values: string[], targetCount: number): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeWaitingMessageText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= targetCount) break;
  }
  return deduped;
}

function resetWaitingMessagePoolForConfig(config: AppConfig): void {
  const key = waitingMessagePoolKey(config);
  if (!activeWaitingMessagePoolKey) {
    activeWaitingMessagePoolKey = key;
    return;
  }
  if (activeWaitingMessagePoolKey === key) return;
  activeWaitingMessagePoolKey = key;
  state.waitingMessageCandidates = [];
}

async function saveWaitingMessagePool(config: AppConfig, pool: WaitingMessagePool): Promise<void> {
  activeWaitingMessagePoolKey = waitingMessagePoolKey(config);
  state.waitingMessageCandidates = pool;
  await persistState(config.paths.stateFile);
}

async function generateWaitingMessageBatch(agentService: AiService, count: number): Promise<string[]> {
  try {
    const outputs = await agentService.generateWaitingMessageCandidates(count);
    return dedupeWaitingMessageTexts(outputs, count);
  } catch {
    const rawCount = Math.max(count * 2, count + 2);
    const outputs = await Promise.all(Array.from({ length: Math.max(0, rawCount) }, async () => {
      try {
        const text = await agentService.generateWaitingMessageCandidate();
        return text.trim();
      } catch {
        return "";
      }
    }));
    return dedupeWaitingMessageTexts(outputs, count);
  }
}

export function warmWaitingMessageCandidates(agentService: AiService, config: AppConfig): Promise<WaitingMessagePool> {
  const key = waitingMessagePoolKey(config);
  resetWaitingMessagePoolForConfig(config);
  if (waitingMessageCache.key === key && waitingMessageCache.promise) return waitingMessageCache.promise;

  const unused = state.waitingMessageCandidates.filter((item) => !item.used);
  if (unused.length >= waitingMessageTargetCount(config)) {
    return Promise.resolve(state.waitingMessageCandidates);
  }

  waitingMessageCache.key = key;
  waitingMessageCache.promise = (async () => {
    const base = state.waitingMessageCandidates.filter((item) => !item.used).map((item) => ({ ...item, used: false }));
    const missing = Math.max(0, waitingMessageTargetCount(config) - base.length);
    const generated = missing > 0 ? await generateWaitingMessageBatch(agentService, missing) : [];
    const seen = new Set<string>();
    const merged = [...base, ...generated.map((text) => ({ text, used: false }))].filter((item) => {
      const normalized = normalizeWaitingMessageText(item.text);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      item.text = normalized;
      return true;
    }).slice(0, waitingMessageTargetCount(config));
    await saveWaitingMessagePool(config, merged);
    return merged;
  })().finally(() => {
    waitingMessageCache.promise = null;
  });
  return waitingMessageCache.promise;
}

export async function replenishWaitingMessageCandidates(agentService: AiService, config: AppConfig): Promise<number> {
  resetWaitingMessagePoolForConfig(config);
  const beforeUnused = state.waitingMessageCandidates.filter((item) => !item.used).length;
  await warmWaitingMessageCandidates(agentService, config);
  const afterUnused = state.waitingMessageCandidates.filter((item) => !item.used).length;
  return Math.max(0, afterUnused - beforeUnused);
}

export async function consumeWaitingMessageCandidate(config: AppConfig): Promise<string | null> {
  resetWaitingMessagePoolForConfig(config);

  const unusedIndexes = state.waitingMessageCandidates
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.used && item.text.trim());

  const allIndexes = state.waitingMessageCandidates
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.text.trim());

  const pool = unusedIndexes.length > 0 ? unusedIndexes : allIndexes;
  if (pool.length === 0) return null;

  const picked = pool[Math.floor(Math.random() * pool.length)];
  if (!picked.item.used) {
    state.waitingMessageCandidates[picked.index] = { ...picked.item, used: true };
    await persistState(config.paths.stateFile);
  }
  return picked.item.text.trim();
}

function logTextContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 500) return JSON.stringify(trimmed);
  return `${JSON.stringify(trimmed.slice(0, 500))}...[truncated chars=${trimmed.length}]`;
}

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

async function prepareAssistantContext(config: AppConfig, input: {
  requesterUserId?: number;
  chatId: number;
  messageTime?: string;
}): Promise<{ assistantContextText: string; requesterTimezone: string | null }> {
  const assistantContextText = await buildAssistantContextBlock(config, {
    requesterUserId: input.requesterUserId,
    chatId: input.chatId,
    messageTime: input.messageTime,
  });
  return {
    assistantContextText,
    requesterTimezone: lookupRequesterTimezone(config, input.requesterUserId),
  };
}

export type RunAssistantTaskDeps = {
  config: AppConfig;
  ctx: Context;
  task: ActiveConversationTask;
  promptText: string;
  uploadedFiles: UploadedFile[];
  attachments: AiAttachment[];
  messageTime?: string;
  agentService: AiService;
  isTaskCurrent: (scopeKey: string, taskId: number) => boolean;
  onPruneRecentUploads: (scopeKey: string) => Promise<void>;
  onStopWaiting: (task: ActiveConversationTask) => void;
  onSetReaction: (ctx: Context, emoji: string) => Promise<void>;
  onReleaseActiveTask: (scopeKey: string, taskId: number) => void;
};

// Single-lane assistant: executes native capabilities / repo CLI work and runtime publishes current-turn replies.
export async function runAssistantTask(deps: RunAssistantTaskDeps): Promise<void> {
  const {
    config,
    ctx,
    task,
    promptText,
    uploadedFiles,
    attachments,
    messageTime,
    agentService,
    isTaskCurrent,
    onPruneRecentUploads,
    onStopWaiting,
    onSetReaction,
    onReleaseActiveTask,
  } = deps;

  const userId = task.userId;
  const requesterAccessLevel = accessLevelForUserId(config, userId);
  const accessRole = requesterAccessLevel === "admin"
    ? "admin"
    : requesterAccessLevel === "trusted"
      ? "trusted"
      : "allowed";
  const telegramRequestContext = buildTelegramRequestContext(config, ctx);
  const effectivePromptText = telegramRequestContext ? `${promptText}\n\n${telegramRequestContext}` : promptText;
  const taskStartedAt = Date.now();

  void warmWaitingMessageCandidates(agentService, config);
  let progressTextShown = "";

  const publishProgressText = async (rawText: string): Promise<void> => {
    const text = rawText.trim();
    if (!text || task.cancelled || !isTaskCurrent(task.scopeKey, task.id) || progressTextShown === text) return;
    progressTextShown = text;
    onStopWaiting(task);
    if (typeof task.waitingMessageId === "number") {
      await editMessageTextFormatted(ctx, task.chatId, task.waitingMessageId, text).catch(() => {});
      return;
    }
    const sent = await replyFormatted(ctx, text).catch(() => null) as { message_id?: number } | null;
    if (sent && typeof sent.message_id === "number") {
      task.waitingMessageId = sent.message_id;
    }
  };

  try {
    const { assistantContextText, requesterTimezone } = await prepareAssistantContext(config, {
      requesterUserId: userId,
      chatId: task.chatId,
      messageTime,
    });
    // Fire-and-forget: don't block agent invocation for a diagnostic log line.
    logger.info(`assistant task ${task.id} role=assistant state=start scope=${JSON.stringify(task.scopeKey)} accessRole=${accessRole} uploadedFiles=${uploadedFiles.length} attachments=${attachments.length} promptChars=${effectivePromptText.length}`);

    const startedAt = Date.now();
    const result = await executeAssistantActions({
      config,
      agentService,
      ctx,
      requesterUserId: userId,
      attachments,
      messageTime,
      requesterTimezone,
      canDeliverOutbound: hasAccessLevel(accessRole, "trusted"),
      accessRole,
      userRequestText: effectivePromptText,
      sharedConversationContextText: assistantContextText,
      scopeKey: task.scopeKey,
      scopeLabel: task.scopeLabel,
      isTaskCurrent: () => !task.cancelled,
      onProgress: async (progressMessage) => {
        await publishProgressText(progressMessage);
      },
    } satisfies ExecuteAssistantActionsInput);
    const assistantMs = Date.now() - startedAt;

    if (task.cancelled || !isTaskCurrent(task.scopeKey, task.id)) {
      await logger.warn(`discarding stale assistant result for task ${task.id}`);
      return;
    }

    onStopWaiting(task);
    const message = result.message.trim();
    await logger.info(`assistant task ${task.id} role=assistant state=done ms=${assistantMs} messageChars=${message.length} facts=${result.facts.length} actions=${JSON.stringify(result.completedActions)}`);

    onReleaseActiveTask(task.scopeKey, task.id);
    if (typeof task.waitingMessageId === "number") {
      await ctx.api.deleteMessage(task.chatId, task.waitingMessageId).catch(() => {});
    }

    // Runtime-owned publication: current-turn visible replies are published here.
    // The runtime is the intended owner of current-turn reply publication.
    await deliverAiOutputs(ctx, config, {
      message,
      files: result.files,
      attachments: result.attachments,
      fileWrites: [],
      schedules: [],
      deliveries: [],
      pendingAuthorizations: [],
      tasks: [],
    });
    if (message) {
      await logger.info(`assistant fallback reply send chars=${message.length} content=${logTextContent(message)}`);
      await replyFormatted(ctx, message);
    }

    await onPruneRecentUploads(task.scopeKey);
    await onSetReaction(ctx, "🥰");
    await logger.info(`assistant task ${task.id} completed totalMs=${Date.now() - taskStartedAt} assistantMs=${assistantMs} outputMs=0`);
  } catch (error) {
    if (task.cancelled) {
      await logger.warn(`ignored assistant failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    onStopWaiting(task);
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`assistant handling failed: ${message}`);
    await onPruneRecentUploads(task.scopeKey);
    const failureText = tForUser(config, ctx.from?.id, "task_failed", { error: message });
    if (typeof task.waitingMessageId === "number") {
      await editMessageTextFormatted(ctx, task.chatId, task.waitingMessageId, failureText);
    } else {
      await logger.info(`assistant failure fallback reply send chars=${failureText.length}`);
      await replyFormatted(ctx, failureText);
    }
    await onSetReaction(ctx, "😢");
  } finally {
    onStopWaiting(task);
  }
}
