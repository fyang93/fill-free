import { stat } from "node:fs/promises";
import type { AiAttachment, UploadedFile } from "bot/app/types";
import { logger } from "bot/app/logger";
import { getRecentUploads, hasRecentUploads, retainRecentUploads } from "bot/app/state";
import { uploadedFileToAiAttachment } from "./transport";

export async function buildRecentAttachments(scopeKey: string): Promise<{ files: UploadedFile[]; attachments: AiAttachment[] }> {
  const files = getRecentUploads(scopeKey);
  const settled = await Promise.allSettled(
    files.map(async (file) => ({
      file,
      attachment: file.source === "voice" || file.source === "audio" ? null : await uploadedFileToAiAttachment(file),
    })),
  );

  const validFiles: UploadedFile[] = [];
  const attachments: AiAttachment[] = [];
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

async function filterExistingUploads(files: UploadedFile[]): Promise<UploadedFile[]> {
  const settled = await Promise.allSettled(files.map(async (file) => {
    await stat(file.absolutePath);
    return file;
  }));
  return settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

export async function pruneRecentUploads(scopeKey: string): Promise<void> {
  if (!hasRecentUploads(scopeKey)) return;
  const recentUploads = getRecentUploads(scopeKey);
  const validFiles = await filterExistingUploads(recentUploads);
  if (validFiles.length !== recentUploads.length) {
    retainRecentUploads(scopeKey, validFiles);
    await logger.info(`pruned stale recent uploads: ${recentUploads.length - validFiles.length} removed`);
  }
}
