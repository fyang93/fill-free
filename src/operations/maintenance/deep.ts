import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiService } from "support/ai";
import { pruneInactiveReminderEvents } from "operations/reminders";
import { readReminderEvents, writeReminderEvents } from "operations/reminders/store";
import type { AppConfig } from "scheduling/app/types";
import { logger } from "scheduling/app/logger";
import { persistState, state } from "scheduling/app/state";
import { loadChats, loadUsers } from "operations/context/store";
import { pruneInvalidInvertedIndex } from "operations/context/inverted-index";
import { pruneFinishedTasks } from "support/tasks";

type MemorySnapshot = Map<string, { size: number; mtimeMs: number }>;

function maintenanceTrigger(force: boolean, idleMs: number, suffix: string): string {
  return `${force ? "forced" : `idle ${Math.round(idleMs / 1000)}s`} + ${suffix}`;
}

const MAINTENANCE_TICK_MS = 60 * 1000;

function recentlyChangedFiles(snapshot: MemorySnapshot, lastMaintainedAt: string | null): string[] {
  if (!lastMaintainedAt) return [...snapshot.keys()].sort((a, b) => a.localeCompare(b));
  const since = Date.parse(lastMaintainedAt);
  if (!Number.isFinite(since)) return [...snapshot.keys()].sort((a, b) => a.localeCompare(b));
  return [...snapshot.entries()]
    .filter(([, info]) => info.mtimeMs > since)
    .map(([filePath]) => filePath)
    .sort((a, b) => a.localeCompare(b));
}

async function buildMaintenanceRequest(repoRoot: string, lastMaintainedAt: string | null, changedFiles: string[]): Promise<string> {
  const draft = [
    "Idle memory maintainer pass.",
    lastMaintainedAt ? `Last maintainer pass: ${lastMaintainedAt}` : "Last maintainer pass: none",
    changedFiles.length > 0
      ? `Files changed since last maintainer pass:\n${changedFiles.map((filePath) => `- ${filePath}`).join("\n")}`
      : "Files changed since last maintainer pass: none",
    "Focus on changed files first. Inspect other memory files only if needed for merging or consistency.",
    "Reply with a short summary of repository changes, or say no change.",
  ].filter(Boolean).join("\n\n");

  void repoRoot;
  return draft;
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

async function appendMaintenanceLog(config: AppConfig, entry: string): Promise<void> {
  const logPath = path.join(config.paths.repoRoot, "logs", "maintenance.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, entry, "utf8");
}

async function appendMaintenanceLogSection(
  config: AppConfig,
  startedAt: string,
  trigger: string,
  fields: Record<string, string>,
): Promise<void> {
  await appendMaintenanceLog(config, [
    `## ${startedAt}`,
    `trigger: ${trigger}`,
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    "",
  ].join("\n"));
}

async function notifyMaintenanceChanges(
  agentService: AiService,
  deps: MaintainerDeps,
  facts: string[],
): Promise<void> {
  if (!deps.onChange || facts.length === 0) return;

  const draft = facts.join("\n");
  try {
    const message = await agentService.composeUserReply(draft, []);
    await deps.onChange(message.trim() || draft);
  } catch {
    await deps.onChange(draft);
  }
}

type TelegramChatRecord = {
  type: string;
  title?: string;
  lastSeenAt: string;
};

async function refreshTelegramEntityRegistryLinks(config: AppConfig): Promise<{ userUpdates: number; chatUpdates: number }> {
  const users = loadUsers(config.paths.repoRoot);
  let userUpdates = 0;
  for (const [telegramUserId, user] of Object.entries(state.telegramUserCache)) {
    const canonical = users[telegramUserId];
    if (!canonical) continue;
    if (canonical.username && user.username !== canonical.username) {
      user.username = canonical.username;
      userUpdates += 1;
      continue;
    }
  }
  return { userUpdates, chatUpdates: 0 };
}

function parseSeenAt(value: string | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeChatRegistry(config: AppConfig, chats: Record<string, unknown>): Promise<void> {
  const filePath = path.join(config.paths.repoRoot, "system", "chats.json");
  await writeFile(filePath, `${JSON.stringify({ chats }, null, 2)}\n`, "utf8");
}

async function migrateLegacyGroupChats(config: AppConfig): Promise<{ removedChatIds: string[]; migratedReminderTargets: number; pairs: Array<{ oldChatId: string; newChatId: string; title: string }> }> {
  const chatRegistry = loadChats(config.paths.repoRoot);
  const chats = Object.entries(chatRegistry)
    .map(([chatId, chat]) => ({ chatId, chat: { type: chat.type || "private", title: chat.title, lastSeenAt: chat.lastSeenAt || "" } }))
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
  if (pairs.length > 0) {
    const filePath = path.join(config.paths.repoRoot, "system", "chats.json");
    let rawChats: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as { chats?: Record<string, unknown> };
      rawChats = parsed.chats && typeof parsed.chats === "object" ? parsed.chats : {};
    } catch {
      rawChats = {};
    }

    for (const pair of pairs) {
      if (!(pair.oldChatId in rawChats)) continue;
      delete rawChats[pair.oldChatId];
      delete state.telegramChatCache[pair.oldChatId];
      removedChatIds.push(pair.oldChatId);
    }

    if (removedChatIds.length > 0) {
      await writeChatRegistry(config, rawChats);
    }
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

type MaintainerDeps = { isBusy: () => boolean; onChange?: (summary: string) => Promise<void> };

export type MaintainerRunner = {
  timer: NodeJS.Timeout | null;
  runNow: () => Promise<void>;
};

async function runMaintainerCycle(
  config: AppConfig,
  agentService: AiService,
  deps: MaintainerDeps,
  input: { force: boolean; runningRef: { value: boolean } },
): Promise<void> {
  const { force, runningRef } = input;
  if (runningRef.value) return;
  if (!force && deps.isBusy()) return;

  const lastActivityAt = state.lastActivityAt;
  const idleMs = lastActivityAt ? Date.now() - new Date(lastActivityAt).getTime() : Number.POSITIVE_INFINITY;
  if (!force && (!Number.isFinite(idleMs) || idleMs < config.maintenance.idleAfterMs)) return;

  const preChanges: string[] = [];

  const indexCleanup = await pruneInvalidInvertedIndex(config.paths.repoRoot);
  if (indexCleanup.removedTerms > 0 || indexCleanup.removedPaths > 0) {
    await logger.info(`maintainer loop pruned inverted index removedTerms=${indexCleanup.removedTerms} removedPaths=${indexCleanup.removedPaths}`);
    preChanges.push(`清理了倒排索引：删除 ${indexCleanup.removedTerms} 个词条，移除 ${indexCleanup.removedPaths} 条失效路径`);
  }

  const reminderCleanup = await pruneInactiveReminderEvents(config);
  if (reminderCleanup.removed > 0) {
    await logger.info(`maintainer loop pruned ${reminderCleanup.removed} inactive reminders`);
    preChanges.push(`删除了 ${reminderCleanup.removed} 条失效提醒`);
    await appendMaintenanceLogSection(config, new Date().toISOString(), maintenanceTrigger(force, idleMs, "reminder cleanup"), {
      summary: `pruned ${reminderCleanup.removed} inactive reminders`,
      deleted: reminderCleanup.removedIds.join(", "),
    });
  }

  const removedTmpEntries = await clearTmpContents(config.paths.tmpDir);
  if (removedTmpEntries.length > 0) {
    await logger.info(`maintainer loop cleared ${removedTmpEntries.length} tmp entries`);
    preChanges.push(`清理了 ${removedTmpEntries.length} 个 tmp 项目`);
    await appendMaintenanceLogSection(config, new Date().toISOString(), maintenanceTrigger(force, idleMs, "tmp cleanup"), {
      summary: `cleared ${removedTmpEntries.length} tmp entries`,
      deleted: removedTmpEntries.map((item) => path.join(path.relative(config.paths.repoRoot, config.paths.tmpDir), item)).join(", "),
    });
  }

  const prunedTasks = await pruneFinishedTasks(config);
  if (prunedTasks > 0) {
    await logger.info(`maintainer loop pruned ${prunedTasks} finished tasks`);
    preChanges.push(`清理了 ${prunedTasks} 条已终态任务`);
    await appendMaintenanceLogSection(config, new Date().toISOString(), maintenanceTrigger(force, idleMs, "task cleanup"), {
      summary: `pruned ${prunedTasks} finished tasks`,
    });
  }

  const chatMigration = await migrateLegacyGroupChats(config);
  if (chatMigration.removedChatIds.length > 0) {
    await logger.info(`maintainer loop migrated ${chatMigration.removedChatIds.length} legacy group chats to supergroups remindersUpdated=${chatMigration.migratedReminderTargets}`);
    preChanges.push(`迁移了 ${chatMigration.removedChatIds.length} 个旧 group 到 supergroup`);
    if (chatMigration.migratedReminderTargets > 0) {
      preChanges.push(`更新了 ${chatMigration.migratedReminderTargets} 个 reminder 群组目标`);
    }
    await appendMaintenanceLogSection(config, new Date().toISOString(), maintenanceTrigger(force, idleMs, "chat migration cleanup"), {
      summary: `migrated ${chatMigration.removedChatIds.length} legacy group chats to supergroups`,
      pairs: chatMigration.pairs.map((pair) => `${pair.title}: ${pair.oldChatId} -> ${pair.newChatId}`).join(", "),
      reminderTargetsUpdated: String(chatMigration.migratedReminderTargets),
    });
  }

  const beforeSnapshot = await memorySnapshot(config.paths.repoRoot);
  const currentFingerprint = snapshotFingerprint(beforeSnapshot);
  const changedFiles = force ? [...beforeSnapshot.keys()].sort((a, b) => a.localeCompare(b)) : recentlyChangedFiles(beforeSnapshot, state.lastMaintainedAt);
  if (!force && currentFingerprint === (state.lastMaintenanceFingerprint || "")) {
    await notifyMaintenanceChanges(agentService, deps, preChanges);
    return;
  }
  if (!force && changedFiles.length === 0) {
    state.lastMaintenanceFingerprint = currentFingerprint || null;
    await persistState(config.paths.stateFile);
    await notifyMaintenanceChanges(agentService, deps, preChanges);
    return;
  }

  runningRef.value = true;
  const startedAt = new Date().toISOString();
  try {
    await logger.info(`maintainer loop starting${force ? " (forced)" : ""} after ${Number.isFinite(idleMs) ? `${idleMs}ms` : "unknown"} idle changedFiles=${changedFiles.length}`);
    const request = await buildMaintenanceRequest(config.paths.repoRoot, force ? null : state.lastMaintainedAt, changedFiles);
    const summary = await agentService.runMaintenancePass(request);
    const afterSnapshot = await memorySnapshot(config.paths.repoRoot);
    const afterFingerprint = snapshotFingerprint(afterSnapshot);
    const changes = diffSnapshots(beforeSnapshot, afterSnapshot);
    let registryLinkRefresh = { userUpdates: 0, chatUpdates: 0 };
    try {
      registryLinkRefresh = await refreshTelegramEntityRegistryLinks(config);
    } catch (error) {
      await logger.warn(`maintainer loop registry link refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    state.lastMaintainedAt = new Date().toISOString();
    state.lastMaintenanceFingerprint = afterFingerprint || null;
    await persistState(config.paths.stateFile);
    await logger.info(`maintainer loop finished: ${summary || "(empty summary)"} userRegistryLinksUpdated=${registryLinkRefresh.userUpdates} chatRegistryLinksUpdated=${registryLinkRefresh.chatUpdates}`);
    await appendMaintenanceLogSection(config, startedAt, maintenanceTrigger(force, idleMs, "memory changed"), {
      summary: summary || "no summary",
      created: changes.created.length ? changes.created.join(", ") : "-",
      updated: changes.updated.length ? changes.updated.join(", ") : "-",
      deleted: changes.deleted.length ? changes.deleted.join(", ") : "-",
      userRegistryLinksUpdated: String(registryLinkRefresh.userUpdates),
      chatRegistryLinksUpdated: String(registryLinkRefresh.chatUpdates),
    });
    const memoryChanged = changes.created.length > 0 || changes.updated.length > 0 || changes.deleted.length > 0;
    const facts = [...preChanges];
    if (summary) facts.push(`记忆整理摘要：${summary}`);
    if (changes.created.length > 0) facts.push(`新建文件：${changes.created.join(", ")}`);
    if (changes.updated.length > 0) facts.push(`更新文件：${changes.updated.join(", ")}`);
    if (changes.deleted.length > 0) facts.push(`删除文件：${changes.deleted.join(", ")}`);
    if (registryLinkRefresh.userUpdates > 0) facts.push(`更新了 ${registryLinkRefresh.userUpdates} 个用户 registry 关联`);
    if (registryLinkRefresh.chatUpdates > 0) facts.push(`更新了 ${registryLinkRefresh.chatUpdates} 个聊天 registry 关联`);
    if (force || facts.length > 0 || memoryChanged) {
      await notifyMaintenanceChanges(agentService, deps, facts);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.warn(`maintainer loop failed: ${message}`);
    await appendMaintenanceLogSection(config, startedAt, maintenanceTrigger(force, idleMs, "memory changed"), {
      failed: message,
    });
  } finally {
    runningRef.value = false;
  }
}

async function runMaintainerTick(
  config: AppConfig,
  agentService: AiService,
  deps: MaintainerDeps,
  runningRef: { value: boolean },
): Promise<void> {
  try {
    await runMaintainerCycle(config, agentService, deps, { force: false, runningRef });
  } catch (error) {
    await logger.warn(`maintainer loop tick failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function createMaintainerRunner(
  config: AppConfig,
  agentService: AiService,
  deps: MaintainerDeps,
): MaintainerRunner {
  const runningRef = { value: false };
  const runNow = async (): Promise<void> => {
    await runMaintainerCycle(config, agentService, deps, { force: true, runningRef });
  };
  const timer = !config.maintenance.enabled ? null : setInterval(() => {
    void runMaintainerTick(config, agentService, deps, runningRef);
  }, MAINTENANCE_TICK_MS);

  if (timer) {
    void runMaintainerTick(config, agentService, deps, runningRef);
  }

  return { timer, runNow };
}

export function startMaintainerLoop(
  config: AppConfig,
  agentService: AiService,
  deps: MaintainerDeps,
): NodeJS.Timeout | null {
  return createMaintainerRunner(config, agentService, deps).timer;
}
