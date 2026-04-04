import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { InputFile, type Context } from "grammy";
import type { AppConfig, AiAttachment, UploadedFile } from "scheduling/app/types";
import { findTelegramFileByUniqueId, rememberTelegramFileRecord } from "operations/files/store";

type AnyRecord = Record<string, unknown>;

const INVALID_FILENAME_RE = /[^a-zA-Z0-9._-]+/g;
const REPO_FILE_PATH_RE = /(?:^|[\s`"'(<\[])(assets\/[^\s`"')>\]]+|tmp\/[^\s`"')>\]]+|\/[^\s`"')>\]]+)(?=$|[\s`"')>\]])/gm;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const VOICE_EXTENSIONS = new Set([".ogg", ".oga", ".opus"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".mp4"]);
const PROTECTED_SYSTEM_FILES = new Set([
  path.join("system", "reminders.json"),
  path.join("system", "runtime-state.json"),
  path.join("system", "users.json"),
  path.join("system", "chats.json"),
  path.join("system", "rules.json"),
  path.join("system", "tasks.json"),
  path.join("system", "inverted-index.json"),
]);

function sanitizeFilename(name: string): string {
  const base = path.basename(name || "file");
  const normalized = base.replace(INVALID_FILENAME_RE, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return normalized || "file";
}

function inferExtensionFromMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "audio/ogg" || mimeType === "audio/opus") return ".ogg";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/mp4") return ".m4a";
  if (mimeType === "audio/wav") return ".wav";
  if (mimeType === "video/mp4") return ".mp4";
  return "";
}

async function uniquePath(targetDir: string, filename: string): Promise<{ filename: string; filePath: string }> {
  const parsed = path.parse(filename);
  let counter = 0;
  let nextName = filename;
  let filePath = path.join(targetDir, nextName);

  while (true) {
    try {
      await access(filePath);
      counter += 1;
      nextName = `${parsed.name}-${counter}${parsed.ext}`;
      filePath = path.join(targetDir, nextName);
    } catch {
      return { filename: nextName, filePath };
    }
  }
}

async function downloadTelegramFile(botToken: string, filePath: string): Promise<Uint8Array> {
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function parseDataUri(dataUri: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = dataUri.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.*)$/s);
  if (!match) return null;
  return {
    mimeType: match[1],
    bytes: new Uint8Array(Buffer.from(match[2], "base64")),
  };
}

async function fetchAttachmentBytes(url: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Attachment download failed: ${response.status} ${response.statusText}`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") || undefined,
  };
}

function asRecord(value: unknown): AnyRecord | undefined {
  return value && typeof value === "object" ? value as AnyRecord : undefined;
}

function extractTelegramFileMetadata(message: unknown): Omit<UploadedFile, "savedPath" | "absolutePath" | "sizeBytes" | "filename"> & { fileId: string } | null {
  const record = asRecord(message);
  const document = asRecord(record?.document);
  const voice = asRecord(record?.voice);
  const audio = asRecord(record?.audio);
  const video = asRecord(record?.video);
  const photos = Array.isArray(record?.photo) ? record.photo : [];

  if (typeof document?.file_id === "string") {
    return {
      fileId: document.file_id,
      originalName: sanitizeFilename(typeof document.file_name === "string" ? document.file_name : "document"),
      mimeType: typeof document.mime_type === "string" && document.mime_type.trim() ? document.mime_type : "application/octet-stream",
      source: "document",
      telegramFileUniqueId: typeof document.file_unique_id === "string" && document.file_unique_id.trim() ? document.file_unique_id : undefined,
    };
  }
  if (photos.length > 0) {
    const photo = asRecord(photos[photos.length - 1]);
    if (typeof photo?.file_id === "string") {
      return {
        fileId: photo.file_id,
        originalName: `photo-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        source: "photo",
        telegramFileUniqueId: typeof photo.file_unique_id === "string" && photo.file_unique_id.trim() ? photo.file_unique_id : undefined,
      };
    }
  }
  if (typeof voice?.file_id === "string") {
    const mimeType = typeof voice.mime_type === "string" && voice.mime_type.trim() ? voice.mime_type : "audio/ogg";
    return {
      fileId: voice.file_id,
      originalName: `voice-${Date.now()}${inferExtensionFromMime(mimeType) || ".ogg"}`,
      mimeType,
      source: "voice",
      telegramFileUniqueId: typeof voice.file_unique_id === "string" && voice.file_unique_id.trim() ? voice.file_unique_id : undefined,
      durationSeconds: typeof voice.duration === "number" ? voice.duration : undefined,
    };
  }
  if (typeof audio?.file_id === "string") {
    const mimeType = typeof audio.mime_type === "string" && audio.mime_type.trim() ? audio.mime_type : "audio/mpeg";
    return {
      fileId: audio.file_id,
      originalName: sanitizeFilename(typeof audio.file_name === "string" && audio.file_name.trim() ? audio.file_name : `audio-${Date.now()}${inferExtensionFromMime(mimeType) || ".audio"}`),
      mimeType,
      source: "audio",
      telegramFileUniqueId: typeof audio.file_unique_id === "string" && audio.file_unique_id.trim() ? audio.file_unique_id : undefined,
      audioTitle: typeof audio.title === "string" && audio.title.trim() ? audio.title.trim() : undefined,
      audioPerformer: typeof audio.performer === "string" && audio.performer.trim() ? audio.performer.trim() : undefined,
      durationSeconds: typeof audio.duration === "number" ? audio.duration : undefined,
    };
  }
  if (typeof video?.file_id === "string") {
    const mimeType = typeof video.mime_type === "string" && video.mime_type.trim() ? video.mime_type : "video/mp4";
    return {
      fileId: video.file_id,
      originalName: sanitizeFilename(typeof video.file_name === "string" && video.file_name.trim() ? video.file_name : `video-${Date.now()}${inferExtensionFromMime(mimeType) || ".mp4"}`),
      mimeType,
      source: "video",
      telegramFileUniqueId: typeof video.file_unique_id === "string" && video.file_unique_id.trim() ? video.file_unique_id : undefined,
      durationSeconds: typeof video.duration === "number" ? video.duration : undefined,
    };
  }

  return null;
}

async function persistTelegramFile(ctx: Context, config: AppConfig, fileMeta: Omit<UploadedFile, "savedPath" | "absolutePath" | "sizeBytes" | "filename"> & { fileId: string }): Promise<UploadedFile> {
  let file;
  try {
    file = await ctx.api.getFile(fileMeta.fileId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/file is too big/i.test(message)) {
      throw new Error("Telegram Bot API refused to provide the file because it exceeds Telegram's bot download limit (about 20 MB).");
    }
    throw error;
  }
  if (!file.file_path) {
    throw new Error("Telegram file path is missing");
  }

  const bytes = await downloadTelegramFile(config.telegram.botToken, file.file_path);
  const dateDir = new Date().toISOString().slice(0, 10);
  const targetDir = path.join(config.paths.tmpDir, config.paths.uploadSubdir, dateDir);
  await mkdir(targetDir, { recursive: true });
  const unique = await uniquePath(targetDir, fileMeta.originalName);
  await writeFile(unique.filePath, bytes);

  const uploaded = {
    savedPath: path.relative(config.paths.repoRoot, unique.filePath),
    absolutePath: unique.filePath,
    originalName: fileMeta.originalName,
    filename: unique.filename,
    mimeType: fileMeta.mimeType,
    sizeBytes: bytes.byteLength,
    source: fileMeta.source,
    telegramFileUniqueId: fileMeta.telegramFileUniqueId,
    audioTitle: fileMeta.audioTitle,
    audioPerformer: fileMeta.audioPerformer,
    durationSeconds: fileMeta.durationSeconds,
  } satisfies UploadedFile;
  await rememberTelegramFileRecord(config, uploaded);
  return uploaded;
}

export async function saveTelegramFileFromMessage(
  ctx: Context,
  config: AppConfig,
  message: unknown,
): Promise<UploadedFile | null> {
  const fileMeta = extractTelegramFileMetadata(message);
  if (!fileMeta) return null;
  const existing = await findTelegramFileByUniqueId(config, fileMeta.telegramFileUniqueId);
  if (existing) return existing;
  return persistTelegramFile(ctx, config, fileMeta);
}

export async function saveTelegramFile(
  ctx: Context,
  config: AppConfig,
): Promise<UploadedFile | null> {
  return saveTelegramFileFromMessage(ctx, config, ctx.message);
}

export async function uploadedFileToAiAttachment(file: UploadedFile): Promise<AiAttachment> {
  const bytes = new Uint8Array(await readFile(file.absolutePath));
  return {
    mimeType: file.mimeType,
    filename: file.filename,
    url: toDataUri(bytes, file.mimeType),
  };
}

export function extractCandidateFilePaths(text: string): string[] {
  const matches = Array.from(text.matchAll(REPO_FILE_PATH_RE))
    .map((match) => (match[1] || "").trim())
    .filter(Boolean)
    .map((item) => item.replace(/[),.;:]+$/g, ""));
  return Array.from(new Set(matches));
}

async function sendInputFileByMime(ctx: Context, filePath: string, mimeType: string, filename?: string): Promise<void> {
  const input = new InputFile(filePath, filename);
  if (mimeType.startsWith("image/")) {
    await ctx.replyWithPhoto(input);
    return;
  }
  if (mimeType.startsWith("audio/")) {
    const ext = path.extname(filename || filePath).toLowerCase();
    if (VOICE_EXTENSIONS.has(ext) || mimeType === "audio/ogg" || mimeType === "audio/opus") {
      await ctx.replyWithVoice(input);
      return;
    }
    await ctx.replyWithAudio(input);
    return;
  }
  await ctx.replyWithDocument(input);
}

export async function sendLocalFiles(ctx: Context, config: AppConfig, candidates: string[]): Promise<string[]> {
  const matches = Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean)));
  const sent: string[] = [];
  for (const candidate of matches) {
    const absPath = path.isAbsolute(candidate) ? candidate : path.resolve(config.paths.repoRoot, candidate);
    const relPath = path.relative(config.paths.repoRoot, absPath);
    if (relPath.startsWith("..")) continue;
    if (PROTECTED_SYSTEM_FILES.has(relPath)) continue;
    try {
      const info = await stat(absPath);
      if (!info.isFile()) continue;
      const ext = path.extname(absPath).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        await ctx.replyWithPhoto(new InputFile(absPath));
      } else if (VOICE_EXTENSIONS.has(ext)) {
        await ctx.replyWithVoice(new InputFile(absPath));
      } else if (AUDIO_EXTENSIONS.has(ext)) {
        await ctx.replyWithAudio(new InputFile(absPath));
      } else {
        await ctx.replyWithDocument(new InputFile(absPath));
      }
      sent.push(relPath);
    } catch {
      // ignore invalid paths
    }
  }
  return sent;
}

export async function sendAiAttachments(ctx: Context, config: AppConfig, attachments: AiAttachment[]): Promise<number> {
  let sent = 0;
  const tempDir = path.join(config.paths.tmpDir, config.paths.uploadSubdir, "outgoing");
  await mkdir(tempDir, { recursive: true });

  for (const attachment of attachments) {
    try {
      const parsed = attachment.url.startsWith("data:") ? parseDataUri(attachment.url) : null;
      const fetched = parsed ? null : await fetchAttachmentBytes(attachment.url);
      const mimeType = parsed?.mimeType || fetched?.mimeType || attachment.mimeType || "application/octet-stream";
      const bytes = parsed?.bytes || fetched?.bytes;
      if (!bytes) continue;

      const ext = path.extname(attachment.filename || "") || inferExtensionFromMime(mimeType);
      const base = sanitizeFilename(path.basename(attachment.filename || `attachment-${Date.now()}${ext}`));
      const unique = await uniquePath(tempDir, base);
      await writeFile(unique.filePath, bytes);
      try {
        await sendInputFileByMime(ctx, unique.filePath, mimeType, attachment.filename || unique.filename);
        sent += 1;
      } finally {
        await unlink(unique.filePath).catch(() => {});
      }
    } catch {
      // ignore invalid attachments
    }
  }

  return sent;
}
