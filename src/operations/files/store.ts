import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, UploadedFile } from "scheduling/app/types";

export type TelegramFileRecord = Omit<UploadedFile, "absolutePath"> & {
  telegramFileUniqueId: string;
  firstSavedAt: string;
  lastSeenAt: string;
};

type FilesStore = {
  telegramFilesByUniqueId: Record<string, TelegramFileRecord>;
};

function filesStorePath(repoRoot: string): string {
  return path.join(repoRoot, "system", "files.json");
}

async function readFilesStore(repoRoot: string): Promise<FilesStore> {
  try {
    const raw = await readFile(filesStorePath(repoRoot), "utf8");
    const parsed = JSON.parse(raw) as { telegramFilesByUniqueId?: Record<string, TelegramFileRecord> };
    return {
      telegramFilesByUniqueId: parsed.telegramFilesByUniqueId && typeof parsed.telegramFilesByUniqueId === "object"
        ? parsed.telegramFilesByUniqueId
        : {},
    };
  } catch {
    return { telegramFilesByUniqueId: {} };
  }
}

async function writeFilesStore(repoRoot: string, store: FilesStore): Promise<void> {
  const filePath = filesStorePath(repoRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function toRecord(file: UploadedFile, now: string): TelegramFileRecord | null {
  if (!file.telegramFileUniqueId) return null;
  return {
    savedPath: file.savedPath,
    originalName: file.originalName,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    source: file.source,
    telegramFileUniqueId: file.telegramFileUniqueId,
    audioTitle: file.audioTitle,
    audioPerformer: file.audioPerformer,
    durationSeconds: file.durationSeconds,
    firstSavedAt: now,
    lastSeenAt: now,
  };
}

function toUploadedFile(config: AppConfig, record: TelegramFileRecord): UploadedFile {
  return {
    savedPath: record.savedPath,
    absolutePath: path.resolve(config.paths.repoRoot, record.savedPath),
    originalName: record.originalName,
    filename: record.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    source: record.source,
    telegramFileUniqueId: record.telegramFileUniqueId,
    audioTitle: record.audioTitle,
    audioPerformer: record.audioPerformer,
    durationSeconds: record.durationSeconds,
  };
}

export async function rememberTelegramFileRecord(config: AppConfig, file: UploadedFile): Promise<void> {
  const now = new Date().toISOString();
  const next = toRecord(file, now);
  if (!next) return;
  const store = await readFilesStore(config.paths.repoRoot);
  const previous = store.telegramFilesByUniqueId[next.telegramFileUniqueId];
  store.telegramFilesByUniqueId[next.telegramFileUniqueId] = {
    ...next,
    firstSavedAt: previous?.firstSavedAt || next.firstSavedAt,
    lastSeenAt: now,
  };
  await writeFilesStore(config.paths.repoRoot, store);
}

export async function findTelegramFileByUniqueId(config: AppConfig, telegramFileUniqueId: string | undefined): Promise<UploadedFile | null> {
  const key = telegramFileUniqueId?.trim();
  if (!key) return null;
  const store = await readFilesStore(config.paths.repoRoot);
  const record = store.telegramFilesByUniqueId[key];
  if (!record) return null;
  const uploaded = toUploadedFile(config, record);
  try {
    const info = await stat(uploaded.absolutePath);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    delete store.telegramFilesByUniqueId[key];
    await writeFilesStore(config.paths.repoRoot, store);
    return null;
  }
  store.telegramFilesByUniqueId[key] = { ...record, lastSeenAt: new Date().toISOString() };
  await writeFilesStore(config.paths.repoRoot, store);
  return uploaded;
}

export async function pruneMissingTelegramFileRecords(config: AppConfig): Promise<number> {
  const store = await readFilesStore(config.paths.repoRoot);
  const entries = Object.entries(store.telegramFilesByUniqueId);
  let removed = 0;
  for (const [key, record] of entries) {
    const filePath = path.resolve(config.paths.repoRoot, record.savedPath);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("not a file");
    } catch {
      delete store.telegramFilesByUniqueId[key];
      removed += 1;
    }
  }
  if (removed > 0) {
    await writeFilesStore(config.paths.repoRoot, store);
  }
  return removed;
}
