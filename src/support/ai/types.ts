import type { AiAttachment } from "scheduling/app/types";

export type ActionTargetReference = {
  id?: number;
  username?: string;
  displayName?: string;
};

export type OutboundMessageDraft = {
  message: string;
  target?: ActionTargetReference | string | number;
  targetUser?: ActionTargetReference;
  targetUsers?: ActionTargetReference[];
  sendAt?: string;
};

export type ReminderDraft = {
  title: string;
  note?: string;
  schedule: Record<string, unknown>;
  category?: "routine" | "special";
  specialKind?: "birthday" | "festival" | "anniversary" | "memorial";
  kind?: "routine" | "meeting" | "birthday" | "anniversary" | "festival" | "memorial" | "task" | "custom";
  timeSemantics?: "absolute" | "local";
  timezone?: string;
  subjectTimezone?: string;
  notifications?: Array<{ id?: string; offsetMinutes: number; enabled?: boolean; label?: string }>;
  targetUser?: ActionTargetReference;
  targetUsers?: ActionTargetReference[];
};

export type PendingAuthorizationDraft = {
  username: string;
  expiresAt: string;
};

export type TaskDraft = {
  domain: string;
  operation: string;
  subject?: {
    kind?: string;
    id?: string;
    scope?: Record<string, string | number | boolean>;
  };
  payload?: Record<string, unknown>;
  dependsOn?: string[];
  dedupeKey?: string;
  supersedesTaskIds?: string[];
};

export type FileWriteDraft = {
  path: string;
  content: string;
  operation?: string;
  action?: string;
};

export type AiTurnResult = {
  message: string;
  answerMode: "direct" | "needs-execution";
  files: string[];
  fileWrites: FileWriteDraft[];
  attachments: AiAttachment[];
  reminders: ReminderDraft[];
  outboundMessages: OutboundMessageDraft[];
  pendingAuthorizations: PendingAuthorizationDraft[];
  tasks: TaskDraft[];
};
