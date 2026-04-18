export type AppConfig = {
  telegram: {
    botToken: string;
    adminUserId: number | null;
    waitingMessage: string;
    waitingMessageCandidateCount?: number;
    waitingMessageRotationSeconds?: number;
    inputMergeWindowSeconds: number;
    menuPageSize: number;
  };
  bot: {
    personaStyle: string;
    language: "zh-CN" | "en";
    defaultTimezone: string;
  };
  paths: {
    repoRoot: string;
    tmpDir: string;
    uploadSubdir: string;
    logFile: string;
    stateFile: string;
  };
  maintenance: {
    enabled: boolean;
    idleAfterMs: number;
    tmpRetentionDays: number;
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
  source: "document" | "photo" | "voice" | "audio" | "video";
  telegramFileUniqueId?: string;
  audioTitle?: string;
  audioPerformer?: string;
  durationSeconds?: number;
};

export type AiAttachment = {
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

export type WaitingMessageCandidate = {
  text: string;
  used: boolean;
};

export type SessionState = {
  model: string | null;
  lastActivityAt: string | null;
  lastMaintainedAt: string | null;
  waitingMessageCandidates: WaitingMessageCandidate[];
  recentUploadsByScope: Record<string, { files: UploadedFile[]; recentUploadsAt: string | null }>;
  recentClarificationsByScope: Record<string, { requestText: string; clarificationMessage: string; updatedAt: string }>;
  // Runtime caches hydrated from canonical system registries and refreshed during execution.
  // These improve hot-path reads but are not the source of truth.
  userTimezoneCache: Record<string, { timezone: string; updatedAt: string }>;
  telegramUserCache: Record<string, { username?: string; firstName?: string; lastName?: string; displayName: string; lastSeenAt: string }>;
  telegramChatCache: Record<string, { type: string; title?: string; lastSeenAt: string }>;
  pendingAuthorizations: PendingAuthorization[];
};
