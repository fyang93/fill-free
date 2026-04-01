export type AppConfig = {
  telegram: {
    botToken: string;
    allowedUserIds: number[];
    trustedUserIds: number[];
    adminUserId: number | null;
    maxFileSizeMb: number;
    personaStyle: string;
    language: "zh" | "en";
    waitingMessage: string;
    waitingMessageCandidates: string[];
    waitingMessageRotationMs: number;
    reminderMessageTimeoutMs: number;
    menuPageSize: number;
  };
  paths: {
    repoRoot: string;
    tmpDir: string;
    uploadSubdir: string;
    logFile: string;
    stateFile: string;
  };
  opencode: {
    baseUrl: string;
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
  source: "document" | "photo" | "voice" | "audio";
};

export type PromptAttachment = {
  mimeType: string;
  filename?: string;
  url: string;
};

export type SessionState = {
  sessionId: string | null;
  model: string | null;
  lastActivityAt: string | null;
  recentUploads: UploadedFile[];
  recentUploadsAt: string | null;
  userTimezones: Record<string, { timezone: string; updatedAt: string }>;
};
