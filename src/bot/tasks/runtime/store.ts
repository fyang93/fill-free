import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readScheduleEvents } from "bot/operations/schedules/store";
import type { AppConfig } from "bot/app/types";
import { logger } from "bot/app/logger";

export type TaskState = "queued" | "running" | "blocked" | "done" | "failed" | "cancelled" | "superseded";

export type TaskRecord = {
  id: string;
  state: TaskState;
  domain: string;
  operation: string;
  availableAt?: string;
  subject?: {
    kind?: string;
    id?: string;
    scope?: Record<string, string | number | boolean>;
  };
  payload: Record<string, unknown>;
  dependsOn?: string[];
  dedupeKey?: string;
  supersedesTaskIds?: string[];
  source?: {
    requesterUserId?: number;
    chatId?: number;
    messageId?: number;
  };
  createdAt: string;
  updatedAt: string;
  result?: Record<string, unknown>;
  error?: {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
};

type TaskStore = { tasks: TaskRecord[] };

const ACTIVE_TASK_STATES: TaskState[] = ["queued", "running", "blocked"];
let taskStoreWriteQueue: Promise<void> = Promise.resolve();

function tasksPath(config: AppConfig): string {
  return path.join(config.paths.repoRoot, "system", "tasks.json");
}

function normalizeSubject(raw: unknown): TaskRecord["subject"] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === "string" && record.kind.trim() ? record.kind.trim() : undefined;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
  const scope = record.scope && typeof record.scope === "object" && !Array.isArray(record.scope)
    ? Object.fromEntries(
        Object.entries(record.scope as Record<string, unknown>)
          .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
      ) as Record<string, string | number | boolean>
    : undefined;
  if (!kind && !id && (!scope || Object.keys(scope).length === 0)) return undefined;
  return { kind, id, scope };
}

function normalizeTask(raw: unknown): TaskRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : "";
  const state = typeof record.state === "string" && ["queued", "running", "blocked", "done", "failed", "cancelled", "superseded"].includes(record.state)
    ? record.state as TaskState
    : "queued";
  const domain = typeof record.domain === "string" && record.domain.trim() ? record.domain.trim() : "";
  const operation = typeof record.operation === "string" && record.operation.trim() ? record.operation.trim() : "";
  const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : {};
  const dependsOn = Array.isArray(record.dependsOn)
    ? record.dependsOn.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
    : undefined;
  const dedupeKey = typeof record.dedupeKey === "string" && record.dedupeKey.trim() ? record.dedupeKey.trim() : undefined;
  const supersedesTaskIds = Array.isArray(record.supersedesTaskIds)
    ? record.supersedesTaskIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
    : undefined;
  const source = record.source && typeof record.source === "object" && !Array.isArray(record.source)
    ? {
        requesterUserId: Number.isInteger(Number((record.source as Record<string, unknown>).requesterUserId)) ? Number((record.source as Record<string, unknown>).requesterUserId) : undefined,
        chatId: Number.isInteger(Number((record.source as Record<string, unknown>).chatId)) ? Number((record.source as Record<string, unknown>).chatId) : undefined,
        messageId: Number.isInteger(Number((record.source as Record<string, unknown>).messageId)) ? Number((record.source as Record<string, unknown>).messageId) : undefined,
      }
    : undefined;
  const createdAt = typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt.trim() : "";
  const updatedAt = typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt.trim() : createdAt;
  const availableAt = typeof record.availableAt === "string" && record.availableAt.trim() ? record.availableAt.trim() : undefined;
  const result = record.result && typeof record.result === "object" && !Array.isArray(record.result)
    ? record.result as Record<string, unknown>
    : undefined;
  const error = record.error && typeof record.error === "object" && !Array.isArray(record.error)
    ? {
        message: typeof (record.error as Record<string, unknown>).message === "string" ? (record.error as Record<string, unknown>).message as string : "",
        code: typeof (record.error as Record<string, unknown>).code === "string" ? (record.error as Record<string, unknown>).code as string : undefined,
        details: (record.error as Record<string, unknown>).details && typeof (record.error as Record<string, unknown>).details === "object" && !Array.isArray((record.error as Record<string, unknown>).details)
          ? (record.error as Record<string, unknown>).details as Record<string, unknown>
          : undefined,
      }
    : undefined;
  if (!id || !domain || !operation || !createdAt) return null;
  return {
    id,
    state,
    domain,
    operation,
    subject: normalizeSubject(record.subject),
    payload,
    availableAt,
    dependsOn,
    dedupeKey,
    supersedesTaskIds,
    source,
    createdAt,
    updatedAt,
    result,
    error: error?.message ? error : undefined,
  };
}

async function loadTaskStore(config: AppConfig): Promise<TaskStore> {
  try {
    const rawText = await readFile(tasksPath(config), "utf8");
    const parsed = JSON.parse(rawText) as { tasks?: unknown };
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask).filter((item): item is TaskRecord => Boolean(item)) : [],
    };
  } catch {
    return { tasks: [] };
  }
}

async function writeTaskStore(config: AppConfig, store: TaskStore): Promise<void> {
  const filePath = tasksPath(config);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function queueTaskStoreWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = taskStoreWriteQueue.then(operation, operation);
  taskStoreWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

function taskLogContext(task: Pick<TaskRecord, "id" | "domain" | "operation" | "source" | "state">): string {
  return `id=${task.id} state=${task.state} domain=${task.domain} operation=${task.operation} requester=${task.source?.requesterUserId ?? "unknown"} chat=${task.source?.chatId ?? "unknown"} message=${task.source?.messageId ?? "unknown"}`;
}

function taskSummary(task: TaskRecord): string {
  const base = `${task.domain}.${task.operation}`;
  const subjectKind = task.subject?.kind?.trim();
  const subjectId = task.subject?.id?.trim();
  if (task.domain === "schedules" && subjectKind === "schedule" && subjectId) {
    return `${base}（schedule: ${subjectId}）`;
  }
  if (task.domain === "messages") {
    const recipient = typeof task.payload.recipientLabel === "string" && task.payload.recipientLabel.trim()
      ? task.payload.recipientLabel.trim()
      : Number.isInteger(Number(task.payload.recipientId))
        ? `recipient ${Number(task.payload.recipientId)}`
        : "message delivery";
    return `${base}（${recipient}）`;
  }
  if (subjectKind || subjectId) {
    return `${base}（${[subjectKind, subjectId].filter(Boolean).join(": ")}）`;
  }
  return base;
}

function shouldLogTaskAccepted(task: Pick<TaskRecord, "domain" | "operation">): boolean {
  return !(task.domain === "schedules" && task.operation === "prepare-delivery-text");
}

async function mutateTaskStore<T>(config: AppConfig, operation: (store: TaskStore) => Promise<T>): Promise<T> {
  return queueTaskStoreWrite(async () => {
    const store = await loadTaskStore(config);
    return operation(store);
  });
}

export async function readTasks(config: AppConfig): Promise<TaskRecord[]> {
  const store = await loadTaskStore(config);
  return store.tasks;
}

export async function writeTasks(config: AppConfig, tasks: TaskRecord[]): Promise<void> {
  await queueTaskStoreWrite(async () => writeTaskStore(config, { tasks }));
}

export async function enqueueTask(config: AppConfig, draft: Omit<TaskRecord, "id" | "state" | "createdAt" | "updatedAt"> & { id?: string }): Promise<TaskRecord> {
  return mutateTaskStore(config, async (store) => {
    const now = new Date().toISOString();
    const dedupeKey = draft.dedupeKey?.trim();
    if (dedupeKey) {
      const existing = store.tasks.find((task) => task.dedupeKey === dedupeKey && ACTIVE_TASK_STATES.includes(task.state));
      if (existing) {
        if (shouldLogTaskAccepted(existing)) {
          await logger.info(`task accepted existing ${taskLogContext(existing)} dedupe=yes`);
        }
        return existing;
      }
    }

    const supersedes = new Set((draft.supersedesTaskIds || []).filter(Boolean));
    const supersededTaskIds: string[] = [];
    const tasks = store.tasks.map((task) => {
      if (supersedes.has(task.id) && ACTIVE_TASK_STATES.includes(task.state)) {
        supersededTaskIds.push(task.id);
        return { ...task, state: "superseded" as const, updatedAt: now };
      }
      return task;
    });

    const task: TaskRecord = {
      id: draft.id?.trim() || `tsk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      state: "queued",
      domain: draft.domain,
      operation: draft.operation,
      subject: draft.subject,
      payload: draft.payload,
      availableAt: draft.availableAt,
      dependsOn: draft.dependsOn?.filter(Boolean),
      dedupeKey,
      supersedesTaskIds: draft.supersedesTaskIds?.filter(Boolean),
      source: draft.source,
      createdAt: now,
      updatedAt: now,
      result: draft.result,
      error: draft.error,
    };
    tasks.push(task);
    await writeTaskStore(config, { tasks });
    if (shouldLogTaskAccepted(task)) {
      await logger.info(`task accepted ${taskLogContext(task)} dependsOn=${task.dependsOn?.length || 0} superseded=${supersededTaskIds.length}`);
    }
    return task;
  });
}

export async function markTaskState(config: AppConfig, taskId: string, state: TaskState, input?: { result?: Record<string, unknown>; error?: TaskRecord["error"] }): Promise<void> {
  await mutateTaskStore(config, async (store) => {
    const now = new Date().toISOString();
    const tasks = store.tasks.map((task) => task.id === taskId ? {
      ...task,
      state,
      updatedAt: now,
      result: input?.result ?? task.result,
      error: input?.error,
    } : task);
    await writeTaskStore(config, { tasks });
  });
}

export async function dequeueRunnableTask(config: AppConfig): Promise<TaskRecord | null> {
  return mutateTaskStore(config, async (store) => {
    const done = new Set(store.tasks.filter((task) => task.state === "done").map((task) => task.id));
    const now = Date.now();
    const next = store.tasks.find((task) => task.state === "queued"
      && (!task.availableAt || (Number.isFinite(Date.parse(task.availableAt)) && Date.parse(task.availableAt) <= now))
      && (task.dependsOn || []).every((id) => done.has(id)));
    if (!next) return null;
    next.state = "running";
    next.updatedAt = new Date().toISOString();
    await writeTaskStore(config, store);
    return next;
  });
}

export async function removeTask(config: AppConfig, taskId: string): Promise<boolean> {
  return mutateTaskStore(config, async (store) => {
    const next = store.tasks.filter((task) => task.id !== taskId);
    const changed = next.length !== store.tasks.length;
    if (changed) await writeTaskStore(config, { tasks: next });
    return changed;
  });
}

export async function pruneFinishedTasks(config: AppConfig): Promise<{ removed: number; removedSummaries: string[] }> {
  return mutateTaskStore(config, async (store) => {
    const removedTasks = store.tasks.filter((task) => ["done", "failed", "cancelled", "superseded"].includes(task.state));
    const next = store.tasks.filter((task) => !["done", "failed", "cancelled", "superseded"].includes(task.state));
    const removedSummaries = removedTasks.map((task) => taskSummary(task)).sort((a, b) => a.localeCompare(b));
    const removed = removedTasks.length;
    if (removed > 0) await writeTaskStore(config, { tasks: next });
    return { removed, removedSummaries };
  });
}

export async function pruneOrphanedSchedulePreparationTasks(config: AppConfig): Promise<{ removed: number; removedSummaries: string[] }> {
  const schedules = await readScheduleEvents(config);
  const existingScheduleIds = new Set(schedules.map((event) => event.id));
  return mutateTaskStore(config, async (store) => {
    const removedTasks = store.tasks.filter((task) => {
      if (task.domain !== "schedules" || task.operation !== "prepare-delivery-text") return false;
      const payloadScheduleId = typeof task.payload.scheduleId === "string" && task.payload.scheduleId.trim() ? task.payload.scheduleId.trim() : "";
      const subjectScheduleId = task.subject?.kind === "schedule" && task.subject?.id?.trim() ? task.subject.id.trim() : "";
      const scheduleId = payloadScheduleId || subjectScheduleId;
      return !scheduleId || !existingScheduleIds.has(scheduleId);
    });
    const removedIds = new Set(removedTasks.map((task) => task.id));
    const next = store.tasks.filter((task) => !removedIds.has(task.id));
    const removedSummaries = removedTasks.map((task) => taskSummary(task)).sort((a, b) => a.localeCompare(b));
    const removed = removedTasks.length;
    if (removed > 0) await writeTaskStore(config, { tasks: next });
    return { removed, removedSummaries };
  });
}

export async function failStaleRunningTasks(config: AppConfig, staleAfterMs = 15 * 60 * 1000): Promise<{ changed: number; changedSummaries: string[] }> {
  return mutateTaskStore(config, async (store) => {
    const now = Date.now();
    const changedTasks: TaskRecord[] = [];
    const next = store.tasks.map((task) => {
      if (task.state !== "running") return task;
      const updatedAt = Date.parse(task.updatedAt || task.createdAt);
      if (!Number.isFinite(updatedAt) || now - updatedAt < staleAfterMs) return task;
      const changed: TaskRecord = {
        ...task,
        state: "failed",
        updatedAt: new Date().toISOString(),
        error: {
          message: `stale running task recovered after ${Math.round((now - updatedAt) / 1000)}s without completion`,
          code: "stale-running-task",
        },
      };
      changedTasks.push(changed);
      return changed;
    });
    if (changedTasks.length > 0) await writeTaskStore(config, { tasks: next });
    return {
      changed: changedTasks.length,
      changedSummaries: changedTasks.map((task) => taskSummary(task)).sort((a, b) => a.localeCompare(b)),
    };
  });
}
