import { stat } from "node:fs/promises";
import type { PromptAttachment, UploadedFile } from "../app/types";
import { logger } from "../app/logger";
import { getRecentUploads, hasRecentUploads, retainRecentUploads } from "../app/state";
import { uploadedFileToAttachment } from "./transport";

export async function buildRecentAttachments(scopeKey: string): Promise<{ files: UploadedFile[]; attachments: PromptAttachment[] }> {
  const files = getRecentUploads(scopeKey);
  const settled = await Promise.allSettled(
    files.map(async (file) => ({
      file,
      attachment: file.source === "voice" || file.source === "audio" ? null : await uploadedFileToAttachment(file),
    })),
  );

  const validFiles: UploadedFile[] = [];
  const attachments: PromptAttachment[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      validFiles.push(result.value.file);
      if (result.value.attachment) attachments.push(result.value.attachment);
      continue;
    }
    await logger.warn(`skipping missing recent upload: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  }

  if (validFiles.length !== files.length) retainRecentUploads(scopeKey, validFiles);
  return { files: validFiles, attachments };
}

export async function pruneRecentUploads(scopeKey: string): Promise<void> {
  if (!hasRecentUploads(scopeKey)) return;
  const recentUploads = getRecentUploads(scopeKey);
  const settled = await Promise.allSettled(recentUploads.map(async (file) => {
    await stat(file.absolutePath);
    return file;
  }));

  const validFiles: UploadedFile[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") validFiles.push(result.value);
  }

  if (validFiles.length !== recentUploads.length) {
    retainRecentUploads(scopeKey, validFiles);
    await logger.info(`pruned stale recent uploads: ${recentUploads.length - validFiles.length} removed`);
  }
}
