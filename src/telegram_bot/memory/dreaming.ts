import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentService } from "../agent";
import { pruneInactiveReminderEvents } from "../reminders";
import { readReminderEvents, writeReminderEvents } from "../reminders/store";
import { formatAvailableSkills, loadAvailableProjectSkills } from "../skills/catalog";
import type { AppConfig } from "../app/types";
import { logger } from "../app/logger";
import { persistState, state } from "../app/state";

type MemorySnapshot = Map<string, { size: number; mtimeMs: number }>;

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

function recentlyChangedFiles(snapshot: MemorySnapshot, lastDreamedAt: string | null): string[] {
  if (!lastDreamedAt) return [...snapshot.keys()].sort((a, b) => a.localeCompare(b));
  const since = Date.parse(lastDreamedAt);
  if (!Number.isFinite(since)) return [...snapshot.keys()].sort((a, b) => a.localeCompare(b));
  return [...snapshot.entries()]
    .filter(([, info]) => info.mtimeMs > since)
    .map(([filePath]) => filePath)
    .sort((a, b) => a.localeCompare(b));
}

async function buildDreamRequest(repoRoot: string, lastDreamedAt: string | null, changedFiles: string[]): Promise<string> {
  const draft = [
    "Idle memory maintenance.",
    lastDreamedAt ? `Last dreaming: ${lastDreamedAt}` : "Last dreaming: none",
    changedFiles.length > 0
      ? `Files changed since last dreaming:\n${changedFiles.map((filePath) => `- ${filePath}`).join("\n")}`
      : "Files changed since last dreaming: none",
    "Focus on changed files first. Inspect other memory files only if needed for merging or consistency.",
    "Reply with a short summary of repository changes, or say no change.",
  ].filter(Boolean).join("\n\n");

  const availableSkills = loadAvailableProjectSkills(repoRoot);
  const skillCatalog = availableSkills.length > 0 ? formatAvailableSkills(availableSkills) : "";

  return [draft, skillCatalog].filter(Boolean).join("\n\n");
}

async function walkMemoryFiles(root: string, dir = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkMemoryFiles(root, fullPath);
    if (!entry.isFile()) return [];
    const relative = path.relative(root, fullPath);
    if (!relative || relative === "reminders.json") return [];
    return [fullPath];
  }));

  return nested.flat().sort((a, b) => a.localeCompare(b));
}

async function memorySnapshot(repoRoot: string): Promise<MemorySnapshot> {
  const memoryRoot = path.join(repoRoot, "memory");
  const files = await walkMemoryFiles(memoryRoot);
  const snapshot: MemorySnapshot = new Map();

  await Promise.all(files.map(async (filePath) => {
    const info = await stat(filePath);
    snapshot.set(path.relative(repoRoot, filePath), { size: info.size, mtimeMs: info.mtimeMs });
  }));

  return snapshot;
}

function snapshotFingerprint(snapshot: MemorySnapshot): string {
  return [...snapshot.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, info]) => `${filePath}:${info.size}:${info.mtimeMs}`)
    .join("|");
}

function diffSnapshots(before: MemorySnapshot, after: MemorySnapshot): { created: string[]; updated: string[]; deleted: string[] } {
  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];

  for (const [filePath, afterInfo] of after.entries()) {
    const beforeInfo = before.get(filePath);
    if (!beforeInfo) {
      created.push(filePath);
      continue;
    }
    if (beforeInfo.size !== afterInfo.size || beforeInfo.mtimeMs !== afterInfo.mtimeMs) {
      updated.push(filePath);
    }
  }

  for (const filePath of before.keys()) {
    if (!after.has(filePath)) deleted.push(filePath);
  }

  return {
    created: created.sort((a, b) => a.localeCompare(b)),
    updated: updated.sort((a, b) => a.localeCompare(b)),
    deleted: deleted.sort((a, b) => a.localeCompare(b)),
  };
}

async function appendDreamLog(config: AppConfig, entry: string): Promise<void> {
  const logPath = path.join(config.paths.repoRoot, "logs", "dreaming.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, entry, "utf8");
}

async function notifyDreamChanges(
  agentService: AgentService,
  deps: DreamDeps,
  facts: string[],
): Promise<void> {
  if (!deps.onChange || facts.length === 0) return;

  try {
    const message = await agentService.composeTelegramReply("", facts);
    await deps.onChange(message.trim() || facts.join("\n"));
  } catch {
    await deps.onChange(facts.join("\n"));
  }
}

type TelegramChatRecord = {
  type: string;
  title?: string;
  username?: string;
  lastSeenAt: string;
};

function parseSeenAt(value: string | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function migrateLegacyGroupChats(config: AppConfig): Promise<{ removedChatIds: string[]; migratedReminderTargets: number; pairs: Array<{ oldChatId: string; newChatId: string; title: string }> }> {
  const chats = Object.entries(state.telegramChats)
    .map(([chatId, chat]) => ({ chatId, chat }))
    .filter(({ chat }) => chat.title && (chat.type === "group" || chat.type === "supergroup"));

  const byTitle = new Map<string, Array<{ chatId: string; chat: TelegramChatRecord }>>();
  for (const entry of chats) {
    const title = entry.chat.title?.trim();
    if (!title) continue;
    const bucket = byTitle.get(title) || [];
    bucket.push(entry as { chatId: string; chat: TelegramChatRecord });
    byTitle.set(title, bucket);
  }

  const pairs: Array<{ oldChatId: string; newChatId: string; title: string }> = [];
  for (const [title, entries] of byTitle.entries()) {
    const supergroups = entries.filter(({ chat }) => chat.type === "supergroup");
    const groups = entries.filter(({ chat }) => chat.type === "group");
    if (supergroups.length === 0 || groups.length === 0) continue;
    const newestSupergroup = supergroups.sort((a, b) => parseSeenAt(b.chat.lastSeenAt) - parseSeenAt(a.chat.lastSeenAt))[0];
    if (!newestSupergroup) continue;
    for (const group of groups) {
      pairs.push({ oldChatId: group.chatId, newChatId: newestSupergroup.chatId, title });
    }
  }

  if (pairs.length === 0) return { removedChatIds: [], migratedReminderTargets: 0, pairs: [] };

  const migrationMap = new Map(pairs.map((pair) => [pair.oldChatId, pair]));
  const reminders = await readReminderEvents(config);
  let migratedReminderTargets = 0;
  let remindersChanged = false;
  for (const event of reminders) {
    let eventChanged = false;
    for (const target of event.targets) {
      if (target.targetKind !== "chat") continue;
      const migration = migrationMap.get(String(target.targetId));
      if (!migration) continue;
      target.targetId = Number(migration.newChatId);
      target.displayName = migration.title;
      migratedReminderTargets += 1;
      eventChanged = true;
    }
    if (eventChanged) {
      event.updatedAt = new Date().toISOString();
      remindersChanged = true;
    }
  }
  if (remindersChanged) {
    await writeReminderEvents(config, reminders);
  }

  const removedChatIds: string[] = [];
  for (const pair of pairs) {
    if (!state.telegramChats[pair.oldChatId]) continue;
    delete state.telegramChats[pair.oldChatId];
    removedChatIds.push(pair.oldChatId);
  }
  if (removedChatIds.length > 0) {
    await persistState(config.paths.stateFile);
  }

  return { removedChatIds: removedChatIds.sort((a, b) => a.localeCompare(b)), migratedReminderTargets, pairs };
}

async function clearTmpContents(root: string, dir = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".gitkeep") continue;
    const fullPath = path.join(dir, entry.name);
    try {
      await rm(fullPath, { recursive: true, force: true });
      removed.push(path.relative(root, fullPath));
    } catch {
      // ignore concurrent or permission failures
    }
  }

  return removed.sort((a, b) => a.localeCompare(b));
}

type DreamDeps = { isBusy: () => boolean; onChange?: (summary: string) => Promise<void> };

export type DreamRunner = {
  timer: NodeJS.Timeout | null;
  runNow: () => Promise<void>;
};

async function runDreamCycle(
  config: AppConfig,
  agentService: AgentService,
  deps: DreamDeps,
  input: { force: boolean; runningRef: { value: boolean } },
): Promise<void> {
  const { force, runningRef } = input;
  if (runningRef.value) return;
  if (!force && deps.isBusy()) return;

  const lastActivityAt = state.lastActivityAt;
  const idleMs = lastActivityAt ? Date.now() - new Date(lastActivityAt).getTime() : Number.POSITIVE_INFINITY;
  if (!force && (!Number.isFinite(idleMs) || idleMs < config.dreaming.idleAfterMs)) return;

  const preChanges: string[] = [];

  const reminderCleanup = await pruneInactiveReminderEvents(config);
  if (reminderCleanup.removed > 0) {
    await logger.info(`dream loop pruned ${reminderCleanup.removed} inactive reminders`);
    preChanges.push(`删除了 ${reminderCleanup.removed} 条失效提醒`);
    await appendDreamLog(config, [
      `## ${new Date().toISOString()}`,
      `trigger: ${force ? "forced" : `idle ${Math.round(idleMs / 1000)}s`} + reminder cleanup`,
      `summary: pruned ${reminderCleanup.removed} inactive reminders`,
      `deleted: ${reminderCleanup.removedIds.join(", ")}`,
      "",
    ].join("\n"));
  }

  const removedTmpEntries = await clearTmpContents(config.paths.tmpDir);
  if (removedTmpEntries.length > 0) {
    await logger.info(`dream loop cleared ${removedTmpEntries.length} tmp entries`);
    preChanges.push(`清理了 ${removedTmpEntries.length} 个 tmp 项目`);
    await appendDreamLog(config, [
      `## ${new Date().toISOString()}`,
      `trigger: ${force ? "forced" : `idle ${Math.round(idleMs / 1000)}s`} + tmp cleanup`,
      `summary: cleared ${removedTmpEntries.length} tmp entries`,
      `deleted: ${removedTmpEntries.map((item) => path.join(path.relative(config.paths.repoRoot, config.paths.tmpDir), item)).join(", ")}`,
      "",
    ].join("\n"));
  }

  const chatMigration = await migrateLegacyGroupChats(config);
  if (chatMigration.removedChatIds.length > 0) {
    await logger.info(`dream loop migrated ${chatMigration.removedChatIds.length} legacy group chats to supergroups remindersUpdated=${chatMigration.migratedReminderTargets}`);
    preChanges.push(`迁移了 ${chatMigration.removedChatIds.length} 个旧 group 到 supergroup`);
    if (chatMigration.migratedReminderTargets > 0) {
      preChanges.push(`更新了 ${chatMigration.migratedReminderTargets} 个 reminder 群组目标`);
    }
    await appendDreamLog(config, [
      `## ${new Date().toISOString()}`,
      `trigger: ${force ? "forced" : `idle ${Math.round(idleMs / 1000)}s`} + chat migration cleanup`,
      `summary: migrated ${chatMigration.removedChatIds.length} legacy group chats to supergroups`,
      `pairs: ${chatMigration.pairs.map((pair) => `${pair.title}: ${pair.oldChatId} -> ${pair.newChatId}`).join(", ")}`,
      `reminderTargetsUpdated: ${chatMigration.migratedReminderTargets}`,
      "",
    ].join("\n"));
  }

  const beforeSnapshot = await memorySnapshot(config.paths.repoRoot);
  const currentFingerprint = snapshotFingerprint(beforeSnapshot);
  const changedFiles = force ? [...beforeSnapshot.keys()].sort((a, b) => a.localeCompare(b)) : recentlyChangedFiles(beforeSnapshot, state.lastDreamedAt);
  if (!force && currentFingerprint === (state.lastDreamedMemoryFingerprint || "")) {
    await notifyDreamChanges(agentService, deps, preChanges);
    return;
  }
  if (!force && changedFiles.length === 0) {
    state.lastDreamedMemoryFingerprint = currentFingerprint || null;
    await persistState(config.paths.stateFile);
    await notifyDreamChanges(agentService, deps, preChanges);
    return;
  }

  runningRef.value = true;
  const startedAt = new Date().toISOString();
  try {
    await logger.info(`dream loop starting${force ? " (forced)" : ""} after ${Number.isFinite(idleMs) ? `${idleMs}ms` : "unknown"} idle changedFiles=${changedFiles.length}`);
    const request = await buildDreamRequest(config.paths.repoRoot, force ? null : state.lastDreamedAt, changedFiles);
    const summary = await withTimeout(agentService.runMemoryDream(request), config.dreaming.timeoutMs, "dream loop");
    const afterSnapshot = await memorySnapshot(config.paths.repoRoot);
    const afterFingerprint = snapshotFingerprint(afterSnapshot);
    const changes = diffSnapshots(beforeSnapshot, afterSnapshot);
    state.lastDreamedAt = new Date().toISOString();
    state.lastDreamedMemoryFingerprint = afterFingerprint || null;
    await persistState(config.paths.stateFile);
    await logger.info(`dream loop finished: ${summary || "(empty summary)"}`);
    await appendDreamLog(config, [
      `## ${startedAt}`,
      `trigger: ${force ? "forced" : `idle ${Math.round(idleMs / 1000)}s`} + memory changed`,
      `summary: ${summary || "no summary"}`,
      `created: ${changes.created.length ? changes.created.join(", ") : "-"}`,
      `updated: ${changes.updated.length ? changes.updated.join(", ") : "-"}`,
      `deleted: ${changes.deleted.length ? changes.deleted.join(", ") : "-"}`,
      "",
    ].join("\n"));
    const memoryChanged = changes.created.length > 0 || changes.updated.length > 0 || changes.deleted.length > 0;
    if (preChanges.length > 0 || memoryChanged) {
      const facts = [...preChanges];
      if (summary) facts.push(`记忆整理摘要：${summary}`);
      if (changes.created.length > 0) facts.push(`新建文件：${changes.created.join(", ")}`);
      if (changes.updated.length > 0) facts.push(`更新文件：${changes.updated.join(", ")}`);
      if (changes.deleted.length > 0) facts.push(`删除文件：${changes.deleted.join(", ")}`);
      await notifyDreamChanges(agentService, deps, facts);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.warn(`dream loop failed: ${message}`);
    await appendDreamLog(config, [
      `## ${startedAt}`,
      `trigger: ${force ? "forced" : `idle ${Math.round(idleMs / 1000)}s`} + memory changed`,
      `failed: ${message}`,
      "",
    ].join("\n"));
  } finally {
    runningRef.value = false;
  }
}

export function createDreamRunner(
  config: AppConfig,
  agentService: AgentService,
  deps: DreamDeps,
): DreamRunner {
  const runningRef = { value: false };
  const runNow = async (): Promise<void> => {
    await runDreamCycle(config, agentService, deps, { force: true, runningRef });
  };
  const timer = !config.dreaming.enabled ? null : setInterval(() => {
    void runDreamCycle(config, agentService, deps, { force: false, runningRef }).catch(async (error) => {
      await logger.warn(`dream loop tick failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, config.dreaming.checkIntervalMs);

  if (timer) {
    void runDreamCycle(config, agentService, deps, { force: false, runningRef }).catch(async (error) => {
      await logger.warn(`dream loop tick failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  return { timer, runNow };
}

export function startDreamLoop(
  config: AppConfig,
  agentService: AgentService,
  deps: DreamDeps,
): NodeJS.Timeout | null {
  return createDreamRunner(config, agentService, deps).timer;
}
