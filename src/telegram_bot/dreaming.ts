import { appendFile, mkdir, readFile, readdir, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import type { OpenCodeService } from "./opencode";
import { pruneInactiveReminderEvents } from "./reminders";
import type { AppConfig } from "./types";
import { logger } from "./logger";
import { state } from "./state";

const MEMORY_AGENT_SKILL_PATH = path.join(process.cwd(), ".agents/skills/memory-agent/SKILL.md");

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

async function loadMemoryAgentRules(): Promise<string> {
  try {
    return (await readFile(MEMORY_AGENT_SKILL_PATH, "utf8")).trim();
  } catch {
    return "";
  }
}

async function buildDreamRequest(): Promise<string> {
  const memoryAgentRules = await loadMemoryAgentRules();
  return [
    "The bot is idle. Reorganize long-term memory in this repository, mainly under memory/.",
    "Follow the repository memory workflow and the memory-agent rules below.",
    memoryAgentRules ? `Memory-agent rules:\n\n${memoryAgentRules}` : "",
    "You may create, merge, split, rename, or delete old note files during reorganization, but do not lose information.",
    "If something is uncertain, preserve the uncertainty instead of inventing a resolution.",
    "If no meaningful reorganization is needed, leave the repository unchanged.",
    "After finishing, reply with a short summary of what changed, or say that no cleanup was needed.",
  ].filter(Boolean).join("\n\n");
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

async function removeEmptyDirsUnder(root: string, dir = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    removed.push(...await removeEmptyDirsUnder(root, fullPath));
  }

  if (dir === root) return removed;

  try {
    const remaining = await readdir(dir);
    if (remaining.length === 0) {
      await rmdir(dir);
      removed.push(path.relative(root, dir) || ".");
    }
  } catch {
    // ignore concurrent or permission failures
  }

  return removed.sort((a, b) => a.localeCompare(b));
}

export function startDreamLoop(
  config: AppConfig,
  opencode: OpenCodeService,
  deps: { isBusy: () => boolean; onChange?: (summary: string) => Promise<void> },
): NodeJS.Timeout | null {
  if (!config.dreaming.enabled) return null;

  let running = false;
  let lastDreamedFingerprint: string | null = null;

  const tick = async () => {
    if (running) return;
    if (deps.isBusy()) return;

    const lastActivityAt = state.lastActivityAt;
    if (!lastActivityAt) return;

    const idleMs = Date.now() - new Date(lastActivityAt).getTime();
    if (!Number.isFinite(idleMs) || idleMs < config.dreaming.idleAfterMs) return;

    const preChanges: string[] = [];

    const reminderCleanup = await pruneInactiveReminderEvents(config);
    if (reminderCleanup.removed > 0) {
      await logger.info(`dream loop pruned ${reminderCleanup.removed} inactive reminders`);
      preChanges.push(`删除了 ${reminderCleanup.removed} 条失效提醒`);
      await appendDreamLog(config, [
        `## ${new Date().toISOString()}`,
        `trigger: idle ${Math.round(idleMs / 1000)}s + reminder cleanup`,
        `summary: pruned ${reminderCleanup.removed} inactive reminders`,
        `deleted: ${reminderCleanup.removedIds.join(", ")}`,
        "",
      ].join("\n"));
    }

    const removedEmptyTmpDirs = await removeEmptyDirsUnder(config.paths.tmpDir);
    if (removedEmptyTmpDirs.length > 0) {
      await logger.info(`dream loop removed ${removedEmptyTmpDirs.length} empty tmp directories`);
      preChanges.push(`清理了 ${removedEmptyTmpDirs.length} 个空的 tmp 目录`);
      await appendDreamLog(config, [
        `## ${new Date().toISOString()}`,
        `trigger: idle ${Math.round(idleMs / 1000)}s + tmp cleanup`,
        `summary: removed ${removedEmptyTmpDirs.length} empty tmp directories`,
        `deleted: ${removedEmptyTmpDirs.map((item) => path.join(path.relative(config.paths.repoRoot, config.paths.tmpDir), item)).join(", ")}`,
        "",
      ].join("\n"));
    }

    const beforeSnapshot = await memorySnapshot(config.paths.repoRoot);
    const currentFingerprint = snapshotFingerprint(beforeSnapshot);
    if (!currentFingerprint) {
      if (deps.onChange && preChanges.length > 0) {
        await deps.onChange(["🧠 Dreaming 完成", ...preChanges.map((item) => `- ${item}`)].join("\n"));
      }
      return;
    }
    if (lastDreamedFingerprint === currentFingerprint) {
      if (deps.onChange && preChanges.length > 0) {
        await deps.onChange(["🧠 Dreaming 完成", ...preChanges.map((item) => `- ${item}`)].join("\n"));
      }
      return;
    }

    running = true;
    const startedAt = new Date().toISOString();
    try {
      await logger.info(`dream loop starting after ${idleMs}ms idle`);
      const request = await buildDreamRequest();
      const summary = await withTimeout(opencode.runMemoryDream(request), config.dreaming.timeoutMs, "dream loop");
      const afterSnapshot = await memorySnapshot(config.paths.repoRoot);
      const afterFingerprint = snapshotFingerprint(afterSnapshot);
      const changes = diffSnapshots(beforeSnapshot, afterSnapshot);
      lastDreamedFingerprint = afterFingerprint;
      await logger.info(`dream loop finished: ${summary || "(empty summary)"}`);
      await appendDreamLog(config, [
        `## ${startedAt}`,
        `trigger: idle ${Math.round(idleMs / 1000)}s + memory changed`,
        `summary: ${summary || "no summary"}`,
        `created: ${changes.created.length ? changes.created.join(", ") : "-"}`,
        `updated: ${changes.updated.length ? changes.updated.join(", ") : "-"}`,
        `deleted: ${changes.deleted.length ? changes.deleted.join(", ") : "-"}`,
        "",
      ].join("\n"));
      const memoryChanged = changes.created.length > 0 || changes.updated.length > 0 || changes.deleted.length > 0;
      if (deps.onChange && (preChanges.length > 0 || memoryChanged)) {
        const lines = ["🧠 Dreaming 完成"];
        if (preChanges.length > 0) lines.push(...preChanges.map((item) => `- ${item}`));
        if (memoryChanged) {
          lines.push(`- 记忆整理摘要：${summary || "已完成整理"}`);
          if (changes.created.length > 0) lines.push(`- 新建：${changes.created.join(", ")}`);
          if (changes.updated.length > 0) lines.push(`- 更新：${changes.updated.join(", ")}`);
          if (changes.deleted.length > 0) lines.push(`- 删除：${changes.deleted.join(", ")}`);
        }
        await deps.onChange(lines.join("\n"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.warn(`dream loop failed: ${message}`);
      await appendDreamLog(config, [
        `## ${startedAt}`,
        `trigger: idle ${Math.round(idleMs / 1000)}s + memory changed`,
        `failed: ${message}`,
        "",
      ].join("\n"));
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, config.dreaming.checkIntervalMs);

  void tick();
  return timer;
}
