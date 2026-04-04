import type { Context } from "grammy";
import { logger } from "scheduling/app/logger";
import type { AiService } from "support/ai";
import type { RequestAccessRole } from "support/ai/prompt";
import type { ActionTargetReference, OutboundMessageDraft, PendingAuthorizationDraft, AiTurnResult, TaskDraft } from "support/ai/types";
import { createStructuredReminders } from "operations/reminders/intent";
import { PENDING_AUTH_ADMIN_ONLY_FACT } from "operations/access/authorizations";
import { enqueueTask } from "support/tasks";
import { resolveChatDisplayName, resolveUserDisplayName } from "operations/context/store";
import { resolveTelegramTargetUsers } from "interaction/telegram/identity";
import type { AppConfig } from "scheduling/app/types";

const OUTBOUND_TARGET_REQUIRED_FACT = "缺少转发目标；请通过 @提及或回复目标消息明确接收方。";
const OUTBOUND_TRUST_REQUIRED_FACT = "当前请求者没有转发权限；只有 trusted 或 admin 才能要求 bot 向其他 Telegram 用户或群聊发送消息。";

export type ActionExecutionResult = {
  facts: string[];
  replyAppendix: string;
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

async function enqueueOutboundMessages(
  config: AppConfig,
  ctx: Context,
  outboundMessages: OutboundMessageDraft[],
  requesterUserId: number | undefined,
): Promise<TaskEnqueueResult> {
  const accepted: string[] = [];
  const clarifications: string[] = [];

  for (const outbound of outboundMessages) {
    const text = typeof outbound.message === "string" ? outbound.message.trim() : "";
    if (!text) continue;
    const rawTargets = Array.isArray(outbound.targetUsers) && outbound.targetUsers.length > 0
      ? outbound.targetUsers
      : outbound.targetUser
        ? [outbound.targetUser]
        : outbound.target != null
          ? [normalizeOutboundTargetReference(outbound.target)].filter((item): item is ActionTargetReference => Boolean(item))
          : [];
    const sendAt = typeof outbound.sendAt === "string" && outbound.sendAt.trim() ? outbound.sendAt.trim() : undefined;
    if (sendAt && !Number.isFinite(Date.parse(sendAt))) {
      clarifications.push(`定时发送时间无效：${sendAt}`);
      continue;
    }
    if (rawTargets.length === 0) {
      clarifications.push(OUTBOUND_TARGET_REQUIRED_FACT);
      continue;
    }
    const targetResult = resolveTelegramTargetUsers(config, rawTargets, ctx, requesterUserId);
    clarifications.push(...targetResult.clarifications);
    for (const target of targetResult.resolved) {
      const recipientId = target.status === "self" ? requesterUserId : target.chatId ?? target.userId;
      if (!recipientId) {
        clarifications.push(OUTBOUND_TARGET_REQUIRED_FACT);
        continue;
      }
      const recipientLabel = target.chatId != null
        ? resolveChatDisplayName(config.paths.repoRoot, target.chatId) || target.displayName || String(recipientId)
        : resolveUserDisplayName(config.paths.repoRoot, target.userId ?? requesterUserId) || target.displayName || String(recipientId);
      await enqueueTask(config, {
        domain: "outbound",
        operation: "send",
        subject: { kind: target.chatId != null ? "chat" : "user", id: String(recipientId) },
        payload: { recipientId, recipientLabel, message: text },
        availableAt: sendAt,
        dedupeKey: `outbound:send:${recipientId}:${sendAt || "now"}:${text}`,
        source: {
          requesterUserId,
          chatId: ctx.chat?.id,
          messageId: ctx.message?.message_id,
        },
      });
      accepted.push(sendAt
        ? `已受理定时发送目标：${recipientLabel}（${sendAt}）`
        : `已受理转发目标：${recipientLabel}`);
    }
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
    accepted.push(`已受理临时授权：@${username}`);
  }
  return { accepted, clarifications: [] };
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
      ? "已受理查询任务；后续会补充结果。"
      : `已受理任务：${task.domain}/${task.operation}`);
  }
  return { accepted, clarifications: [] };
}

// Executor role: durably accept actions and collect confirmed facts for the responder handoff.
export async function executeAiActions(input: ExecuteAiActionsInput): Promise<ActionExecutionResult> {
  const executorStartedAt = Date.now();

  const reminderStartedAt = Date.now();
  const reminderResult = await createStructuredReminders(
    input.config,
    input.agentService,
    input.answer.reminders,
    input.ctx,
    input.requesterUserId,
    input.messageTime,
  );
  const reminderMs = Date.now() - reminderStartedAt;
  await logger.info(`executor reminders done ms=${reminderMs} created=${reminderResult.created.length} clarifications=${reminderResult.clarifications.length} drafts=${input.answer.reminders.length}`);

  const outboundStartedAt = Date.now();
  const outboundResult = input.canDeliverOutbound
    ? await enqueueOutboundMessages(input.config, input.ctx, input.answer.outboundMessages, input.requesterUserId)
    : input.answer.outboundMessages.length > 0
      ? { accepted: [], clarifications: [OUTBOUND_TRUST_REQUIRED_FACT] }
      : { accepted: [], clarifications: [] };
  const outboundMs = Date.now() - outboundStartedAt;
  await logger.info(`executor outbound done ms=${outboundMs} accepted=${outboundResult.accepted.length} clarifications=${outboundResult.clarifications.length} drafts=${input.answer.outboundMessages.length} enabled=${input.canDeliverOutbound ? "yes" : "no"}`);
  const authStartedAt = Date.now();
  const pendingAuthorizationResult = await enqueuePendingAuthorizations(
    input.config,
    input.answer.pendingAuthorizations,
    input.requesterUserId,
    input.accessRole,
    input.ctx,
  );
  const authMs = Date.now() - authStartedAt;
  await logger.info(`executor authorizations done ms=${authMs} accepted=${pendingAuthorizationResult.accepted.length} clarifications=${pendingAuthorizationResult.clarifications.length} drafts=${input.answer.pendingAuthorizations.length}`);
  const taskStartedAt = Date.now();
  const genericTaskResult = await enqueueGenericTasks(input.config, input.ctx, input.answer.tasks, input.requesterUserId);
  const taskMs = Date.now() - taskStartedAt;
  await logger.info(`executor tasks done ms=${taskMs} accepted=${genericTaskResult.accepted.length} clarifications=${genericTaskResult.clarifications.length} drafts=${input.answer.tasks.length}`);
  await logger.info(`executor role total ms=${Date.now() - executorStartedAt}`);

  return {
    facts: [
      summarizeFactBlock("Multiple reminders accepted", reminderResult.created),
      summarizeFactBlock("Multiple outbound messages accepted", outboundResult.accepted),
      summarizeFactBlock("Multiple temporary authorizations accepted", pendingAuthorizationResult.accepted),
      summarizeFactBlock("Multiple queued tasks accepted", genericTaskResult.accepted),
      ...reminderResult.clarifications,
      ...outboundResult.clarifications,
      ...pendingAuthorizationResult.clarifications,
      ...genericTaskResult.clarifications,
    ].filter(Boolean),
    replyAppendix: "",
  };
}
