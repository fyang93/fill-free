import { readFileSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./types";

export type TelegramIdentityBinding = {
  username?: string;
  personNote: string;
  personLabel: string;
  aliases?: string[];
  relationshipRole?: string;
  confidence?: "confirmed" | "suggested" | "unknown";
};

type TelegramBindingsFile = {
  version?: unknown;
  bindings?: Record<string, TelegramIdentityBinding | undefined>;
};

function bindingsPath(config: AppConfig): string {
  return path.join(config.paths.repoRoot, "system", "telegram-links.json");
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizeBinding(value: unknown): TelegramIdentityBinding | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const personNote = cleanOptionalString(record.personNote);
  const personLabel = cleanOptionalString(record.personLabel);
  if (!personNote || !personLabel) return null;
  const confidence = cleanOptionalString(record.confidence);
  return {
    username: cleanOptionalString(record.username),
    personNote,
    personLabel,
    aliases: cleanStringArray(record.aliases),
    relationshipRole: cleanOptionalString(record.relationshipRole),
    confidence: confidence === "confirmed" || confidence === "suggested" || confidence === "unknown" ? confidence : undefined,
  };
}

function loadTelegramBindings(config: AppConfig): Record<string, TelegramIdentityBinding> {
  try {
    const raw = readFileSync(bindingsPath(config), "utf8");
    const parsed = JSON.parse(raw) as TelegramBindingsFile;
    const bindings = parsed.bindings;
    if (!bindings || typeof bindings !== "object") return {};
    const result: Record<string, TelegramIdentityBinding> = {};
    for (const [userId, value] of Object.entries(bindings)) {
      const normalized = normalizeBinding(value);
      if (normalized) result[userId] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

export function getTelegramIdentityBinding(config: AppConfig, userId: number | undefined): TelegramIdentityBinding | null {
  if (!userId) return null;
  return loadTelegramBindings(config)[String(userId)] || null;
}

export function describeTelegramIdentityBinding(config: AppConfig, userId: number | undefined): string | null {
  const binding = getTelegramIdentityBinding(config, userId);
  if (!binding) return null;
  const noteLabel = binding.personNote.startsWith("memory/") ? binding.personNote.slice("memory/".length) : binding.personNote;
  const details = [binding.relationshipRole, binding.confidence].filter(Boolean).join(", ");
  const aliases = binding.aliases && binding.aliases.length > 0 ? ` aliases=${binding.aliases.slice(0, 4).join("/")}` : "";
  return `${noteLabel} / ${binding.personLabel}${details ? ` (${details})` : ""}${aliases}`;
}
