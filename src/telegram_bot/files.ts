import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { InputFile, type Context } from "grammy";
import type { AppConfig, PromptAttachment, UploadedFile } from "./types";

const INVALID_FILENAME_RE = /[^a-zA-Z0-9._-]+/g;
const REPO_FILE_PATH_RE = /(?:^|[\s`"'(<\[])(assets\/[^\s`"')>\]]+|tmp\/[^\s`"')>\]]+|\/[^\s`"')>\]]+)(?=$|[\s`"')>\]])/gm;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const VOICE_EXTENSIONS = new Set([".ogg", ".oga", ".opus"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".mp4"]);

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

export async function saveTelegramFile(
  ctx: Context,
  config: AppConfig,
): Promise<UploadedFile | null> {
  const document = ctx.message && "document" in ctx.message ? ctx.message.document : undefined;
  const photos = ctx.message && "photo" in ctx.message ? ctx.message.photo : undefined;
  const voice = ctx.message && "voice" in ctx.message ? ctx.message.voice : undefined;
  const audio = ctx.message && "audio" in ctx.message ? ctx.message.audio : undefined;

  let fileId: string | undefined;
  let originalName = "file";
  let mimeType = "application/octet-stream";
  let source: UploadedFile["source"] = "document";

  if (document?.file_id) {
    fileId = document.file_id;
    originalName = sanitizeFilename(document.file_name || "document");
    mimeType = document.mime_type || mimeType;
    source = "document";
  } else if (Array.isArray(photos) && photos.length > 0) {
    const photo = photos[photos.length - 1];
    fileId = photo.file_id;
    originalName = `photo-${Date.now()}.jpg`;
    mimeType = "image/jpeg";
    source = "photo";
  } else if (voice?.file_id) {
    fileId = voice.file_id;
    mimeType = voice.mime_type || "audio/ogg";
    originalName = `voice-${Date.now()}${inferExtensionFromMime(mimeType) || ".ogg"}`;
    source = "voice";
  } else if (audio?.file_id) {
    fileId = audio.file_id;
    mimeType = audio.mime_type || "audio/mpeg";
    originalName = sanitizeFilename(audio.file_name || `audio-${Date.now()}${inferExtensionFromMime(mimeType) || ".audio"}`);
    source = "audio";
  }

  if (!fileId) return null;

  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram file path is missing");
  }

  const bytes = await downloadTelegramFile(config.telegram.botToken, file.file_path);
  const maxBytes = config.telegram.maxFileSizeMb * 1024 * 1024;
  if (bytes.byteLength > maxBytes) {
    throw new Error(`File exceeds limit of ${config.telegram.maxFileSizeMb}MB`);
  }

  const dateDir = new Date().toISOString().slice(0, 10);
  const targetDir = path.join(config.paths.tmpDir, config.paths.uploadSubdir, dateDir);
  await mkdir(targetDir, { recursive: true });
  const unique = await uniquePath(targetDir, originalName);
  await writeFile(unique.filePath, bytes);

  return {
    savedPath: path.relative(config.paths.repoRoot, unique.filePath),
    absolutePath: unique.filePath,
    originalName,
    filename: unique.filename,
    mimeType,
    sizeBytes: bytes.byteLength,
    source,
  };
}

export async function uploadedFileToAttachment(file: UploadedFile): Promise<PromptAttachment> {
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
    if (
      relPath === path.join("system", "reminders.json")
      || relPath === path.join("system", "telegram-state.json")
      || relPath === path.join("system", "telegram-links.json")
      || relPath === path.join("index", "reminders.json")
    ) continue;
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

export async function sendPromptAttachments(ctx: Context, config: AppConfig, attachments: PromptAttachment[]): Promise<number> {
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
