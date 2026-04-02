export type AppConfig = {
  telegram: {
    botToken: string;
    allowedUserIds: number[];
    trustedUserIds: number[];
    adminUserId: number | null;
    maxFileSizeMb: number;
  };
  bot: {
    personaStyle: string;
    language: "zh" | "en";
    waitingMessage: string;
    waitingMessageCandidates: string[];
    waitingMessageRotationMs: number;
    reminderMessageTimeoutMs: number;
    promptTaskTimeoutMs: number;
    menuPageSize: number;
    defaultTimezone: string;
  };
  paths: {
    repoRoot: string;
    tmpDir: string;
    uploadSubdir: string;
    logFile: string;
    stateFile: string;
  };
  dreaming: {
    enabled: boolean;
    idleAfterMs: number;
    checkIntervalMs: number;
    timeoutMs: number;
  };
};

export type UploadedFile = {
  savedPath: string;
  absolutePath: string;
  originalName: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  source: "document" | "photo" | "voice" | "audio" | "video";
  audioTitle?: string;
  audioPerformer?: string;
  durationSeconds?: number;
};

export type PromptAttachment = {
  mimeType: string;
  filename?: string;
  url: string;
};

export type PendingAuthorization = {
  kind: "allowed";
  username: string;
  createdBy: number;
  createdAt: string;
  expiresAt: string;
};

export type SessionState = {
  model: string | null;
  lastActivityAt: string | null;
  lastDreamedAt: string | null;
  lastDreamedMemoryFingerprint: string | null;
  recentUploadsByScope: Record<string, { files: UploadedFile[]; recentUploadsAt: string | null }>;
  userTimezones: Record<string, { timezone: string; updatedAt: string }>;
  telegramUsers: Record<string, { username?: string; firstName?: string; lastName?: string; displayName: string; lastSeenAt: string }>;
  telegramChats: Record<string, { type: string; title?: string; username?: string; lastSeenAt: string }>;
  pendingAuthorizations: PendingAuthorization[];
};
