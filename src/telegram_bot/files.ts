import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { InputFile, type Context } from "grammy";
import type { AppConfig, UploadedFile } from "./types";

const INVALID_FILENAME_RE = /[^a-zA-Z0-9._-]+/g;
const REPO_FILE_PATH_RE = /(?:^|[\s`"'(<\[])(assets\/[^\s`"')>\]]+|tmp\/[^\s`"')>\]]+|\/[^\s`"')>\]]+)(?=$|[\s`"')>\]])/gm;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function sanitizeFilename(name: string): string {
  const base = path.basename(name || "file");
  const normalized = base.replace(INVALID_FILENAME_RE, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return normalized || "file";
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

export async function saveTelegramFile(
  ctx: Context,
  config: AppConfig,
): Promise<UploadedFile | null> {
  const document = ctx.message && "document" in ctx.message ? ctx.message.document : undefined;
  const photos = ctx.message && "photo" in ctx.message ? ctx.message.photo : undefined;

  let fileId: string | undefined;
  let originalName = "file";
  let mimeType = "application/octet-stream";

  if (document?.file_id) {
    fileId = document.file_id;
    originalName = sanitizeFilename(document.file_name || "document");
    mimeType = document.mime_type || mimeType;
  } else if (Array.isArray(photos) && photos.length > 0) {
    const photo = photos[photos.length - 1];
    fileId = photo.file_id;
    originalName = `photo-${Date.now()}.jpg`;
    mimeType = "image/jpeg";
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
  };
}

export function extractCandidateFilePaths(text: string): string[] {
  const matches = Array.from(text.matchAll(REPO_FILE_PATH_RE))
    .map((match) => (match[1] || "").trim())
    .filter(Boolean)
    .map((item) => item.replace(/[),.;:]+$/g, ""));
  return Array.from(new Set(matches));
}

export async function sendLocalFiles(ctx: Context, config: AppConfig, candidates: string[]): Promise<string[]> {
  const matches = Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean)));
  const sent: string[] = [];
  for (const candidate of matches) {
    const absPath = path.isAbsolute(candidate) ? candidate : path.resolve(config.paths.repoRoot, candidate);
    const relPath = path.relative(config.paths.repoRoot, absPath);
    if (relPath.startsWith("..")) continue;
    try {
      const info = await stat(absPath);
      if (!info.isFile()) continue;
      const ext = path.extname(absPath).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        await ctx.replyWithPhoto(new InputFile(absPath));
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
