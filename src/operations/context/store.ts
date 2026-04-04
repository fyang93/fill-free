import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { state } from "scheduling/app/state";

type CacheEntry<T> = { mtimeMs: number; value: T };

const jsonCache = new Map<string, CacheEntry<unknown>>();

export type UserRecord = {
  username?: string;
  displayName?: string;
  role?: "allowed" | "trusted";
  memoryPath?: string;
  timezone?: string;
  lastSeenAt?: string;
  updatedAt?: string;
};

export type ChatRecord = {
  type?: string;
  title?: string;
  memoryPath?: string;
  participants?: Record<string, { lastInteractedAt: string }>;
  lastSeenAt?: string;
  updatedAt?: string;
};

export type RuleRecord = {
  id: string;
  appliesTo: {
    domain: string;
    selector?: string;
    userIds?: string[];
    chatIds?: string[];
    taskIds?: string[];
  };
  topic: string;
  content: Record<string, unknown>;
  createdBy?: string;
  updatedAt?: string;
};

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(cleanText).filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
}

function cleanMemoryPath(value: unknown): string | undefined {
  const normalized = cleanText(value)?.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || !normalized.startsWith("memory/") || !normalized.endsWith(".md")) return undefined;
  return normalized;
}

function cleanObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readJsonCached<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const info = statSync(filePath);
    const cached = jsonCache.get(filePath) as CacheEntry<T> | undefined;
    if (cached && cached.mtimeMs === info.mtimeMs) return cached.value;
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as T;
    jsonCache.set(filePath, { mtimeMs: info.mtimeMs, value: parsed });
    return parsed;
  } catch {
    return fallback;
  }
}

export function loadUsers(repoRoot: string): Record<string, UserRecord> {
  const raw = readJsonCached<{ users?: unknown }>(path.join(repoRoot, "system", "users.json"), {});
  const source = cleanObject(raw.users) || {};
  return Object.fromEntries(
    Object.entries(source).map(([userId, value]) => {
      const record = cleanObject(value) || {};
      return [userId, {
        username: cleanText(record.username),
        displayName: cleanText(record.displayName),
        role: record.role === "allowed" || record.role === "trusted" ? record.role : undefined,
        memoryPath: cleanMemoryPath(record.memoryPath),
        timezone: cleanText(record.timezone),
        lastSeenAt: cleanText(record.lastSeenAt),
        updatedAt: cleanText(record.updatedAt),
      } satisfies UserRecord];
    }),
  );
}

export function loadChats(repoRoot: string): Record<string, ChatRecord> {
  const raw = readJsonCached<{ chats?: unknown }>(path.join(repoRoot, "system", "chats.json"), {});
  const source = cleanObject(raw.chats) || {};
  return Object.fromEntries(
    Object.entries(source).map(([chatId, value]) => {
      const record = cleanObject(value) || {};
      return [chatId, {
        type: cleanText(record.type),
        title: cleanText(record.title),
        memoryPath: cleanMemoryPath(record.memoryPath),
        participants: Object.fromEntries(
          Object.entries(cleanObject(record.participants) || {})
            .map(([participantUserId, participantValue]) => {
              const participant = cleanObject(participantValue) || {};
              const lastInteractedAt = cleanText(participant.lastInteractedAt);
              return [participantUserId, lastInteractedAt ? { lastInteractedAt } : undefined] as const;
            })
            .filter(([, participant]) => Boolean(participant)),
        ) as Record<string, { lastInteractedAt: string }> | undefined,
        lastSeenAt: cleanText(record.lastSeenAt),
        updatedAt: cleanText(record.updatedAt),
      } satisfies ChatRecord];
    }),
  );
}

export function loadRules(repoRoot: string): RuleRecord[] {
  const raw = readJsonCached<{ rules?: unknown }>(path.join(repoRoot, "system", "rules.json"), {});
  if (!Array.isArray(raw.rules)) return [];
  const rules: RuleRecord[] = [];
  for (const value of raw.rules) {
    const record = cleanObject(value);
    if (!record) continue;
    const appliesTo = cleanObject(record.appliesTo);
    const topic = cleanText(record.topic);
    const content = cleanObject(record.content);
    const id = cleanText(record.id);
    const domain = cleanText(appliesTo?.domain);
    if (!appliesTo || !topic || !content || !id || !domain) continue;
    rules.push({
      id,
      appliesTo: {
        domain,
        selector: cleanText(appliesTo.selector),
        userIds: cleanStringArray(appliesTo.userIds),
        chatIds: cleanStringArray(appliesTo.chatIds),
        taskIds: cleanStringArray(appliesTo.taskIds),
      },
      topic,
      content,
      createdBy: cleanText(record.createdBy),
      updatedAt: cleanText(record.updatedAt),
    });
  }
  return rules.sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""));
}

function normalizeLookupKey(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function resolveUser(repoRoot: string, userId: number | string | undefined): UserRecord | undefined {
  if (userId == null) return undefined;
  return loadUsers(repoRoot)[String(userId)];
}

export function resolveUserByUsername(repoRoot: string, username: string | undefined): [string, UserRecord] | undefined {
  const cleaned = cleanText(username);
  const normalized = cleaned ? normalizeLookupKey(cleaned) : undefined;
  if (!normalized) return undefined;
  return Object.entries(loadUsers(repoRoot)).find(([, user]) => {
    const keys = new Set([user.username].filter((item): item is string => Boolean(item)).map(normalizeLookupKey));
    return keys.has(normalized);
  });
}

export function resolveChat(repoRoot: string, chatId: number | string | undefined): ChatRecord | undefined {
  if (chatId == null) return undefined;
  return loadChats(repoRoot)[String(chatId)];
}

export function resolveUserDisplayName(repoRoot: string, userId: number | string | undefined): string | undefined {
  const user = resolveUser(repoRoot, userId);
  if (user?.displayName) return user.displayName;
  if (userId != null) {
    const runtime = state.telegramUserCache[String(userId)];
    if (runtime?.displayName) return runtime.displayName;
    if (runtime?.username) return `@${runtime.username}`;
  }
  return undefined;
}

export function resolveChatDisplayName(repoRoot: string, chatId: number | string | undefined): string | undefined {
  const chat = resolveChat(repoRoot, chatId);
  if (chat?.title) return chat.title;
  if (chatId != null) {
    const runtime = state.telegramChatCache[String(chatId)];
    if (runtime?.title) return runtime.title;
  }
  return undefined;
}

function summarizeObject(record: Record<string, unknown> | undefined, maxEntries = 4): string | undefined {
  if (!record) return undefined;
  const directText = cleanText(record.text) || cleanText(record.instruction) || cleanText(record.note);
  if (directText) return directText;
  const parts = Object.entries(record)
    .flatMap(([key, value]) => {
      if (value == null) return [];
      if (Array.isArray(value)) return [`${key}=${value.join("/")}`];
      if (typeof value === "object") return [];
      return [`${key}=${String(value)}`];
    })
    .slice(0, maxEntries);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function appliesToSpecificity(rule: RuleRecord): number {
  const { domain, selector, userIds, chatIds, taskIds } = rule.appliesTo;
  if (domain === "global") return 0;
  if (domain === "tasks") return taskIds && taskIds.length > 0 ? 25 : 20;
  if ((domain === "users" || domain === "chats") && selector === "one") return 40;
  if ((domain === "users" || domain === "chats") && selector === "some") return 30;
  if ((domain === "users" || domain === "chats") && selector === "all") return 10;
  if (userIds?.length === 1 || chatIds?.length === 1) return 40;
  if ((userIds && userIds.length > 1) || (chatIds && chatIds.length > 1)) return 30;
  return 5;
}

function appliesToMatches(rule: RuleRecord, input: { requesterUserId?: string; replyUserId?: string; chatId?: string; taskId?: string }): boolean {
  const userIds = new Set([input.requesterUserId, input.replyUserId].filter((item): item is string => Boolean(item)));
  const { domain, selector, userIds: targetUserIds, chatIds, taskIds } = rule.appliesTo;

  if (domain === "global") return true;
  if (domain === "tasks") return Boolean(input.taskId && taskIds?.includes(input.taskId));
  if (domain === "users") {
    if (selector === "all") return true;
    if (!targetUserIds || targetUserIds.length === 0) return false;
    return targetUserIds.some((id) => userIds.has(id));
  }
  if (domain === "chats") {
    if (selector === "all") return true;
    if (!input.chatId || !chatIds || chatIds.length === 0) return false;
    return chatIds.includes(input.chatId);
  }
  return false;
}

function describeAppliesTo(rule: RuleRecord): string {
  const { domain, selector, userIds, chatIds, taskIds } = rule.appliesTo;
  if (domain === "global") return "global";
  if (domain === "users") {
    if (selector === "all") return "users:all";
    if (selector === "one" && userIds?.[0]) return `user:${userIds[0]}`;
    if (selector === "some" && userIds?.length) return `users:${userIds.join(",")}`;
  }
  if (domain === "chats") {
    if (selector === "all") return "chats:all";
    if (selector === "one" && chatIds?.[0]) return `chat:${chatIds[0]}`;
    if (selector === "some" && chatIds?.length) return `chats:${chatIds.join(",")}`;
  }
  if (domain === "tasks") {
    if (selector === "one" && taskIds?.[0]) return `task:${taskIds[0]}`;
    if (taskIds?.length) return `tasks:${taskIds.join(",")}`;
    return "tasks";
  }
  return domain;
}

export function collectRelevantRules(repoRoot: string, input: { requesterUserId?: number | string; replyUserId?: number | string; chatId?: number | string; taskId?: string }): RuleRecord[] {
  const normalized = {
    requesterUserId: input.requesterUserId == null ? undefined : String(input.requesterUserId),
    replyUserId: input.replyUserId == null ? undefined : String(input.replyUserId),
    chatId: input.chatId == null ? undefined : String(input.chatId),
    taskId: cleanText(input.taskId),
  };

  return loadRules(repoRoot)
    .filter((rule) => appliesToMatches(rule, normalized))
    .sort((a, b) => {
      const specificity = appliesToSpecificity(a) - appliesToSpecificity(b);
      if (specificity !== 0) return specificity;
      return (a.updatedAt || "").localeCompare(b.updatedAt || "");
    });
}

export function buildStructuredContextLines(repoRoot: string, input: { requesterUserId?: number; requesterUsername?: string; replyTargetUserId?: number; replyTargetUsername?: string; chatId?: number; taskId?: string; }): string[] {
  const lines: string[] = [];
  const requesterUserId = input.requesterUserId != null
    ? String(input.requesterUserId)
    : resolveUserByUsername(repoRoot, input.requesterUsername)?.[0];
  const replyUserId = input.replyTargetUserId != null
    ? String(input.replyTargetUserId)
    : resolveUserByUsername(repoRoot, input.replyTargetUsername)?.[0];
  const requesterUser = requesterUserId ? resolveUser(repoRoot, requesterUserId) : undefined;
  const replyUser = replyUserId ? resolveUser(repoRoot, replyUserId) : undefined;
  const chat = resolveChat(repoRoot, input.chatId);

  if (requesterUserId && requesterUser) {
    lines.push(`Requester user: ${requesterUserId}${requesterUser.displayName ? ` (${requesterUser.displayName})` : ""}.`);
    if (requesterUser.memoryPath) lines.push(`Requester user file: ${requesterUser.memoryPath}.`);
  }

  if (replyUserId && replyUser) {
    lines.push(`Reply target user: ${replyUserId}${replyUser.displayName ? ` (${replyUser.displayName})` : ""}.`);
    if (replyUser.memoryPath) lines.push(`Reply target user file: ${replyUser.memoryPath}.`);
  }

  if (chat) {
    const title = chat.title ? `, ${chat.title}` : "";
    lines.push(`Conversation registry: ${chat.type || "chat"}${title}.`);
    if (chat.memoryPath) lines.push(`Conversation file: ${chat.memoryPath}.`);
    const participantIds = Object.entries(chat.participants || {})
      .sort((a, b) => b[1].lastInteractedAt.localeCompare(a[1].lastInteractedAt))
      .slice(0, 5)
      .map(([participantUserId]) => participantUserId);
    if (participantIds.length > 0) lines.push(`Conversation active users: ${participantIds.join(", ")}.`);
  }

  const relevantRules = collectRelevantRules(repoRoot, { requesterUserId, replyUserId, chatId: input.chatId, taskId: input.taskId });
  if (relevantRules.length > 0) {
    lines.push("Relevant structured rules:");
    for (const rule of relevantRules.slice(0, 8)) {
      const content = summarizeObject(rule.content, 5) || "(no content)";
      lines.push(`- ${describeAppliesTo(rule)} / ${rule.topic}: ${content}`);
    }
  }

  return lines;
}
