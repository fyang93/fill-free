export type AppConfig = {
  telegram: {
    botToken: string;
    allowedUserId: number;
    pollingTimeoutSec: number;
    pollingIntervalMs: number;
    maxFileSizeMb: number;
    personaStyle: string;
    language: "zh" | "en";
    waitingMessage: string;
    waitingMessageCandidates: string[];
    waitingMessageRotationMs: number;
  };
  paths: {
    repoRoot: string;
    tmpDir: string;
    uploadSubdir: string;
    logFile: string;
  };
  opencode: {
    baseUrl: string;
  };
};

export type UploadedFile = {
  savedPath: string;
  absolutePath: string;
  originalName: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  source: "document" | "photo" | "voice" | "audio";
};

export type PromptAttachment = {
  mimeType: string;
  filename?: string;
  url: string;
};

export type PendingReminderConfirmation = {
  originalRequest: string;
  referenceTimeIso: string;
  createdAt: string;
};

export type SessionState = {
  sessionId: string | null;
  model: string | null;
  lastActivityAt: string | null;
  recentUploads: UploadedFile[];
  recentUploadsAt: string | null;
  pendingReminderConfirmation: PendingReminderConfirmation | null;
};
