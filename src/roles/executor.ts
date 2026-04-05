import type { Context } from "grammy";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "scheduling/app/logger";
import type { AiService } from "support/ai";
import type { RequestAccessRole } from "support/ai/prompt";
import type { ActionTargetReference, FileWriteDraft, MessageDeliveryDraft, PendingAuthorizationDraft, AiTurnResult, TaskDraft } from "support/ai/types";
import { createStructuredReminders } from "operations/reminders/intent";
import { PENDING_AUTH_ADMIN_ONLY_FACT } from "operations/access/authorizations";
import { enqueueTask } from "support/tasks";
import { resolveChatDisplayName, resolveUserDisplayName } from "operations/context/store";
import { resolveTelegramTargetUsers } from "interaction/telegram/identity";
import type { AppConfig } from "scheduling/app/types";

const OUTBOUND_TARGET_REQUIRED_FACT = "Missing outbound target. Mention @username or reply to a target message.";
const OUTBOUND_TRUST_REQUIRED_FACT = "Requester does not have outbound permission. Only trusted or admin can request outbound delivery.";
const MEMORY_WRITE_ALLOWED_FACT = "Requester does not have permission to write memory.";

export type ActionExecutionResult = {
  message: string;
  facts: string[];
  hasSideEffectfulActions: boolean;
};

export type ExecuteAiActionsInput = {
  config: AppConfig;
  agentService: AiService;
  answer: AiTurnResult;
  ctx: Context;
  requesterUserId?: number;
  messageTime?: string;
  canDeliverOutbound: boolean;
  accessRole: RequestAccessRole;
  userRequestText: string;
  responderContextText?: string;
  isTaskCurrent?: () => boolean;
};

type TaskEnqueueResult = {
  accepted: string[];
  clarifications: string[];
};

function normalizeOutboundTargetReference(raw: unknown): ActionTargetReference | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const id = Number(record.id);
    const username = typeof record.username === "string" && record.username.trim() ? record.username.trim().replace(/^@+/, "") : undefined;
    const displayName = typeof record.displayName === "string" && record.displayName.trim() ? record.displayName.trim() : undefined;
    if (Number.isInteger(id)) return { id, username, displayName };
    if (username || displayName) return { username, displayName };
    return undefined;
  }
  if (typeof raw === "number" && Number.isInteger(raw)) return { id: raw };
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    if (/^-?\d+$/.test(trimmed)) return { id: Number(trimmed) };
    if (/^@/.test(trimmed)) return { username: trimmed.replace(/^@+/, "") };
    return { displayName: trimmed };
  }
  return undefined;
}

function summarizeFactBlock(plural: string, items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] || "";
  return `${plural}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

async function enqueueMessageDeliveries(
  config: AppConfig,
  ctx: Context,
  deliveries: MessageDeliveryDraft[],
  requesterUserId: number | undefined,
): Promise<TaskEnqueueResult> {
  const accepted: string[] = [];
  const clarifications: string[] = [];

  for (const delivery of deliveries) {
    const text = typeof delivery.content === "string" ? delivery.content.trim() : "";
    if (!text) continue;
    const rawTarget = normalizeOutboundTargetReference(delivery.recipient);
    const sendAt = typeof delivery.sendAt === "string" && delivery.sendAt.trim() ? delivery.sendAt.trim() : undefined;
    if (sendAt && !Number.isFinite(Date.parse(sendAt))) {
      clarifications.push(`Invalid scheduled send time: ${sendAt}`);
      continue;
    }
    if (!rawTarget) {
      clarifications.push(OUTBOUND_TARGET_REQUIRED_FACT);
      continue;
    }
    const targetResult = resolveTelegramTargetUsers(config, [rawTarget], ctx, requesterUserId);
    clarifications.push(...targetResult.clarifications);
    const target = targetResult.resolved[0];
    const recipientId = target?.status === "self" ? requesterUserId : target?.chatId ?? target?.userId;
    if (!target || !recipientId) {
      clarifications.push(OUTBOUND_TARGET_REQUIRED_FACT);
      continue;
    }
    const recipientLabel = target.chatId != null
      ? resolveChatDisplayName(config.paths.repoRoot, target.chatId) || target.displayName || String(recipientId)
      : resolveUserDisplayName(config.paths.repoRoot, target.userId ?? requesterUserId) || target.displayName || String(recipientId);
    await enqueueTask(config, {
      domain: "messages",
      operation: "deliver",
      subject: { kind: target.chatId != null ? "chat" : "user", id: String(recipientId) },
      payload: { recipientId, recipientLabel, content: text },
      availableAt: sendAt,
      dedupeKey: `messages:deliver:${recipientId}:${sendAt || "now"}:${text}`,
      source: {
        requesterUserId,
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
      },
    });
    accepted.push(sendAt
      ? `Accepted scheduled delivery target: ${recipientLabel} (${sendAt})`
      : `Accepted delivery target: ${recipientLabel}`);
  }

  return { accepted, clarifications };
}

async function enqueuePendingAuthorizations(
  config: AppConfig,
  drafts: PendingAuthorizationDraft[],
  requesterUserId: number | undefined,
  accessRole: RequestAccessRole,
  ctx: Context,
): Promise<TaskEnqueueResult> {
  if (drafts.length === 0) return { accepted: [], clarifications: [] };
  if (accessRole !== "admin" || !requesterUserId) {
    return { accepted: [], clarifications: [PENDING_AUTH_ADMIN_ONLY_FACT] };
  }
  const accepted: string[] = [];
  for (const item of drafts) {
    const username = item.username.trim().replace(/^@+/, "");
    const expiresAt = item.expiresAt.trim();
    if (!username || !expiresAt) continue;
    await enqueueTask(config, {
      domain: "access",
      operation: "grant-temporary",
      subject: { kind: "username", id: username.toLowerCase() },
      payload: { username, expiresAt },
      dedupeKey: `access:grant-temporary:${username.toLowerCase()}:${expiresAt}`,
      source: {
        requesterUserId,
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
      },
    });
    accepted.push(`Accepted temporary authorization: @${username}`);
  }
  return { accepted, clarifications: [] };
}

async function applyFileWrites(
  config: AppConfig,
  accessRole: RequestAccessRole,
  fileWrites: FileWriteDraft[],
): Promise<TaskEnqueueResult> {
  if (fileWrites.length === 0) return { accepted: [], clarifications: [] };
  if (accessRole === "allowed") return { accepted: [], clarifications: [MEMORY_WRITE_ALLOWED_FACT] };

  const accepted: string[] = [];
  const clarifications: string[] = [];
  const repoRoot = config.paths.repoRoot;

  for (const item of fileWrites) {
    const normalized = item.path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (!normalized.startsWith("memory/") || !normalized.endsWith(".md")) {
      clarifications.push(`Ignored non-memory file write: ${normalized}`);
      continue;
    }
    const targetPath = path.join(repoRoot, normalized);
    const operation = (item.operation || item.action || "append").toLowerCase();
    const content = item.content.trim();
    if (!content) continue;
    await mkdir(path.dirname(targetPath), { recursive: true });
    if (operation.includes("overwrite") || operation.includes("replace") || operation === "write") {
      await writeFile(targetPath, `${content}\n`, "utf8");
      accepted.push(`memory_write overwrite path=${normalized}`);
    } else {
      await appendFile(targetPath, `${content}\n`, "utf8");
      accepted.push(`memory_write append path=${normalized}`);
    }
  }

  return { accepted, clarifications };
}

async function enqueueGenericTasks(
  config: AppConfig,
  ctx: Context,
  tasks: TaskDraft[],
  requesterUserId: number | undefined,
): Promise<TaskEnqueueResult> {
  const accepted: string[] = [];
  for (const task of tasks) {
    const payload = { ...(task.payload || {}) };
    if (task.domain === "query" && task.operation === "answer-from-repo" && typeof payload.requestText !== "string") {
      const requestText = ctx.message && "text" in ctx.message && typeof ctx.message.text === "string" ? ctx.message.text.trim() : "";
      if (requestText) payload.requestText = requestText;
    }
    await enqueueTask(config, {
      domain: task.domain,
      operation: task.operation,
      subject: task.subject,
      payload,
      dependsOn: task.dependsOn,
      dedupeKey: task.dedupeKey,
      supersedesTaskIds: task.supersedesTaskIds,
      source: {
        requesterUserId,
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
      },
    });
    accepted.push(task.domain === "query" && task.operation === "answer-from-repo"
      ? "task_queued query.answer-from-repo"
      : `task_queued ${task.domain}.${task.operation}`);
  }
  return { accepted, clarifications: [] };
}

// Executor role: durably accept actions and collect confirmed facts for the responder handoff.
export async function executeAiActions(input: ExecuteAiActionsInput): Promise<ActionExecutionResult> {
  const executorStartedAt = Date.now();
  const taskStillCurrent = () => (input.isTaskCurrent ? input.isTaskCurrent() : true);

  let effectiveAnswer = input.answer;
  const planned = await input.agentService.planExecutorActions({
    userRequestText: input.userRequestText,
    requesterUserId: input.requesterUserId,
    chatId: input.ctx.chat?.id,
    chatType: input.ctx.chat?.type,
    accessRole: input.accessRole,
    messageTime: input.messageTime,
    responderContextText: input.responderContextText,
  });
  if (!taskStillCurrent()) {
    await logger.warn("executor result ignored because task is stale");
    return { message: "", facts: [], hasSideEffectfulActions: false };
  }
  effectiveAnswer = {
    ...effectiveAnswer,
    reminders: [...effectiveAnswer.reminders, ...planned.reminders],
    deliveries: [...effectiveAnswer.deliveries, ...planned.deliveries],
    pendingAuthorizations: [...effectiveAnswer.pendingAuthorizations, ...planned.pendingAuthorizations],
    tasks: [...effectiveAnswer.tasks, ...planned.tasks],
    files: [...effectiveAnswer.files, ...planned.files],
    fileWrites: [...effectiveAnswer.fileWrites, ...planned.fileWrites],
  };
  await logger.info(`executor actions interpreted reminders=${planned.reminders.length} deliveries=${planned.deliveries.length} pendingAuthorizations=${planned.pendingAuthorizations.length} tasks=${planned.tasks.length} files=${planned.files.length} fileWrites=${planned.fileWrites.length}`);

  const fileWriteStartedAt = Date.now();
  if (!taskStillCurrent()) {
    await logger.warn("executor file writes skipped because task is stale");
    return { message: "", facts: [], hasSideEffectfulActions: false };
  }
  const fileWriteResult = await applyFileWrites(input.config, input.accessRole, effectiveAnswer.fileWrites);
  const fileWriteMs = Date.now() - fileWriteStartedAt;
  await logger.info(`executor file writes done ms=${fileWriteMs} accepted=${fileWriteResult.accepted.length} clarifications=${fileWriteResult.clarifications.length} drafts=${effectiveAnswer.fileWrites.length}`);

  const reminderStartedAt = Date.now();
  if (!taskStillCurrent()) {
    await logger.warn("executor reminders skipped because task is stale");
    return { message: "", facts: [], hasSideEffectfulActions: false };
  }
  const reminderResult = await createStructuredReminders(
    input.config,
    input.agentService,
    effectiveAnswer.reminders,
    input.ctx,
    input.requesterUserId,
    input.messageTime,
  );
  const reminderMs = Date.now() - reminderStartedAt;
  await logger.info(`executor reminders done ms=${reminderMs} created=${reminderResult.created.length} clarifications=${reminderResult.clarifications.length} drafts=${effectiveAnswer.reminders.length}`);

  const deliveryStartedAt = Date.now();
  if (!taskStillCurrent()) {
    await logger.warn("executor deliveries skipped because task is stale");
    return { message: "", facts: [], hasSideEffectfulActions: false };
  }
  const deliveryResult = input.canDeliverOutbound
    ? await enqueueMessageDeliveries(input.config, input.ctx, effectiveAnswer.deliveries, input.requesterUserId)
    : effectiveAnswer.deliveries.length > 0
      ? { accepted: [], clarifications: [OUTBOUND_TRUST_REQUIRED_FACT] }
      : { accepted: [], clarifications: [] };
  const deliveryMs = Date.now() - deliveryStartedAt;
  await logger.info(`executor deliveries done ms=${deliveryMs} accepted=${deliveryResult.accepted.length} clarifications=${deliveryResult.clarifications.length} drafts=${effectiveAnswer.deliveries.length} enabled=${input.canDeliverOutbound ? "yes" : "no"}`);
  const authStartedAt = Date.now();
  if (!taskStillCurrent()) {
    await logger.warn("executor authorizations skipped because task is stale");
    return { message: "", facts: [], hasSideEffectfulActions: false };
  }
  const pendingAuthorizationResult = await enqueuePendingAuthorizations(
    input.config,
    effectiveAnswer.pendingAuthorizations,
    input.requesterUserId,
    input.accessRole,
    input.ctx,
  );
  const authMs = Date.now() - authStartedAt;
  await logger.info(`executor authorizations done ms=${authMs} accepted=${pendingAuthorizationResult.accepted.length} clarifications=${pendingAuthorizationResult.clarifications.length} drafts=${effectiveAnswer.pendingAuthorizations.length}`);
  const taskStartedAt = Date.now();
  if (!taskStillCurrent()) {
    await logger.warn("executor tasks skipped because task is stale");
    return { message: "", facts: [], hasSideEffectfulActions: false };
  }
  const genericTaskResult = await enqueueGenericTasks(input.config, input.ctx, effectiveAnswer.tasks, input.requesterUserId);
  const taskMs = Date.now() - taskStartedAt;
  await logger.info(`executor tasks done ms=${taskMs} accepted=${genericTaskResult.accepted.length} clarifications=${genericTaskResult.clarifications.length} drafts=${effectiveAnswer.tasks.length}`);
  await logger.info(`executor role total ms=${Date.now() - executorStartedAt}`);

  const facts = [
    ...fileWriteResult.clarifications,
    ...reminderResult.clarifications,
    ...deliveryResult.clarifications,
    ...pendingAuthorizationResult.clarifications,
    ...genericTaskResult.clarifications,
  ].filter(Boolean);
  return {
    message: planned.message.trim(),
    facts,
    hasSideEffectfulActions: effectiveAnswer.fileWrites.length > 0
      || effectiveAnswer.reminders.length > 0
      || effectiveAnswer.deliveries.length > 0
      || effectiveAnswer.pendingAuthorizations.length > 0
      || effectiveAnswer.tasks.length > 0,
  };
}
