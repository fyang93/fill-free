import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "scheduling/app/types";
import { reminderEventScheduleSummary, readReminderEvents } from "operations/reminders";
import { matchInvertedIndex } from "./inverted-index";
import { collectRelevantRules, resolveChat, resolveUser } from "./store";

export type ResponderIndexContext = {
  matchedTerms: string[];
  paths: string[];
};

type ResponderContextInput = {
  requesterUserId?: number;
  chatId?: number;
  indexContext?: ResponderIndexContext;
};

async function loadMarkdownFile(repoRoot: string, memoryPath: string | undefined): Promise<{ path: string; content: string } | null> {
  if (!memoryPath) return null;
  try {
    const absolutePath = path.join(repoRoot, memoryPath);
    const raw = await readFile(absolutePath, "utf8");
    const content = raw.trim();
    if (!content) return null;
    return {
      path: memoryPath,
      content: content.length > 4000 ? `${content.slice(0, 4000)}\n\n...[truncated]` : content,
    };
  } catch {
    return null;
  }
}

async function loadRequesterReminders(config: AppConfig, requesterUserId: number | undefined) {
  if (!requesterUserId) return [];
  const events = await readReminderEvents(config);
  return events
    .filter((event) => event.status !== "deleted" && event.targets.some((target) => target.targetKind === "user" && target.targetId === requesterUserId))
    .slice(0, 12)
    .map((event) => ({
      title: event.title,
      status: event.status,
      scheduleSummary: reminderEventScheduleSummary(config, event),
      timezone: event.timezone,
      timeSemantics: event.timeSemantics,
    }));
}

export async function lookupResponderIndexContext(config: AppConfig, queryText: string | undefined): Promise<ResponderIndexContext> {
  if (!queryText?.trim()) return { matchedTerms: [], paths: [] };
  return matchInvertedIndex(config.paths.repoRoot, queryText);
}

export function lookupRequesterTimezone(config: AppConfig, requesterUserId: number | undefined): string | null {
  if (requesterUserId == null) return null;
  return resolveUser(config.paths.repoRoot, requesterUserId)?.timezone || null;
}

export async function buildResponderContextBlock(config: AppConfig, input: ResponderContextInput): Promise<string> {
  const requesterUser = input.requesterUserId != null ? resolveUser(config.paths.repoRoot, input.requesterUserId) : undefined;
  const chat = input.chatId != null ? resolveChat(config.paths.repoRoot, input.chatId) : undefined;
  const requesterFile = await loadMarkdownFile(config.paths.repoRoot, requesterUser?.memoryPath);
  const requesterReminders = await loadRequesterReminders(config, input.requesterUserId);
  const chatFile = await loadMarkdownFile(config.paths.repoRoot, chat?.memoryPath);
  const activeUsers = Object.entries(chat?.participants || {})
    .sort((a, b) => b[1].lastInteractedAt.localeCompare(a[1].lastInteractedAt))
    .slice(0, 3);
  const activeUserFiles = (await Promise.all(activeUsers.map(async ([userId]) => {
    const user = resolveUser(config.paths.repoRoot, userId);
    if (!user?.memoryPath) return null;
    const file = await loadMarkdownFile(config.paths.repoRoot, user.memoryPath);
    return file ? { userId, ...file } : null;
  }))).filter(Boolean);
  const indexedMatch = input.indexContext || { matchedTerms: [], paths: [] };
  const indexedFiles = (await Promise.all(indexedMatch.paths.slice(0, 3).map(async (filePath) => loadMarkdownFile(config.paths.repoRoot, filePath)))).filter(Boolean);
  const relevantRules = [
    ...collectRelevantRules(config.paths.repoRoot, { requesterUserId: input.requesterUserId, chatId: input.chatId }),
    ...collectRelevantRules(config.paths.repoRoot, { requesterUserId: input.requesterUserId, chatId: input.chatId, taskId: "reminders" }),
    ...collectRelevantRules(config.paths.repoRoot, { requesterUserId: input.requesterUserId, chatId: input.chatId, taskId: "outbound" }),
  ].filter((rule, index, rules) => rules.findIndex((item) => item.id === rule.id) === index)
    .slice(0, 8)
    .map((rule) => ({
      id: rule.id,
      topic: rule.topic,
      appliesTo: rule.appliesTo,
      content: rule.content,
      updatedAt: rule.updatedAt,
    }));

  const payload = {
    requesterUser: requesterUser && input.requesterUserId != null ? {
      id: String(input.requesterUserId),
      username: requesterUser.username || null,
      displayName: requesterUser.displayName || null,
      memoryPath: requesterUser.memoryPath || null,
      timezone: requesterUser.timezone || null,
    } : null,
    requesterReminders,
    currentChat: chat && input.chatId != null ? {
      id: String(input.chatId),
      type: chat.type || null,
      title: chat.title || null,
      memoryPath: chat.memoryPath || null,
      activeUserIds: activeUsers.map(([userId]) => userId),
    } : null,
    relevantRules,
    linkedMemoryFiles: [requesterFile, chatFile, ...activeUserFiles, ...indexedFiles].filter(Boolean),
    matchedIndexTerms: indexedMatch.matchedTerms,
  };

  return [
    "Responder context JSON:",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}
