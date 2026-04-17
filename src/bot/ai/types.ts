import type { AiAttachment } from "bot/app/types";

export type ActionTargetReference = {
  id?: number;
  username?: string;
  displayName?: string;
};

export type MessageDeliveryDraft = {
  content: string;
  recipient: ActionTargetReference;
  sendAt?: string;
};

export type ScheduleDraft = {
  title: string;
  note?: string;
  schedule: Record<string, unknown>;
  category?: "routine" | "special" | "automation";
  specialKind?: "birthday" | "festival" | "anniversary" | "memorial";
  timeSemantics?: "absolute" | "local";
  timezone?: string;
  subjectTimezone?: string;
  reminders?: Array<{ id?: string; offsetMinutes: number; enabled?: boolean; label?: string }>;
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
  files: string[];
  fileWrites: FileWriteDraft[];
  attachments: AiAttachment[];
  schedules: ScheduleDraft[];
  deliveries: MessageDeliveryDraft[];
  pendingAuthorizations: PendingAuthorizationDraft[];
  tasks: TaskDraft[];
};

export type AssistantPlanResult = {
  message: string;
  usedNativeExecution: boolean;
  completedActions: string[];
  files?: string[];
  attachments?: AiAttachment[];
};

export type AssistantProgressHandler = (message: string) => Promise<void> | void;
