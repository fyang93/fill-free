import type { PromptAttachment } from "../types";

export type OpenCodeModel = {
  providerID: string;
  modelID: string;
};

export type OpenCodePromptBody = {
  parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string }>;
  model?: OpenCodeModel;
  system: string;
};

export type OpenCodeMessagePart = {
  type?: string;
  text?: string;
  mime?: string;
  filename?: string;
  url?: string;
};

export type OpenCodeMessage = {
  parts?: OpenCodeMessagePart[];
  info?: { structured_output?: unknown };
};

export type PromptReminderTarget = {
  id?: number;
  username?: string;
  displayName?: string;
  role?: string;
};

export type PromptOutboundMessageDraft = {
  message: string;
  targetUser?: PromptReminderTarget;
  targetUsers?: PromptReminderTarget[];
};

export type PromptReminderDraft = {
  title: string;
  note?: string;
  schedule: Record<string, unknown>;
  category?: "routine" | "special";
  specialKind?: "birthday" | "festival" | "anniversary" | "memorial";
  kind?: "routine" | "meeting" | "birthday" | "anniversary" | "festival" | "memorial" | "task" | "custom";
  timeSemantics?: "absolute" | "local";
  timezone?: string;
  notifications?: Array<{ id?: string; offsetMinutes: number; enabled?: boolean; label?: string }>;
  targetUser?: PromptReminderTarget;
  targetUsers?: PromptReminderTarget[];
};

export type PromptResult = {
  message: string;
  files: string[];
  attachments: PromptAttachment[];
  reminders: PromptReminderDraft[];
  outboundMessages: PromptOutboundMessageDraft[];
};
