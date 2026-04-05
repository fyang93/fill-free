import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "@iarna/toml";
import type { AppConfig } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return optionalNumber(value) ?? fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => optionalNumber(item))
    .filter((item): item is number => typeof item === "number" && item > 0);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asLanguage(value: unknown): "zh" | "en" {
  const normalized = stringOr(value, "zh").trim().toLowerCase();
  return normalized === "en" ? "en" : "zh";
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(configPath = path.resolve(process.cwd(), "config.toml")): AppConfig {
  const raw = readFileSync(configPath, "utf8");
  const parsed = asRecord(parse(raw));

  const telegram = asRecord(parsed.telegram);
  const bot = asRecord(parsed.bot);
  const maintenance = asRecord(parsed.maintenance);
  const opencode = asRecord(parsed.opencode);
  const repoRoot = path.resolve(process.cwd());
  const tmpDir = path.resolve(repoRoot, "tmp");
  const uploadSubdir = "telegram";
  const logFile = path.resolve(repoRoot, "logs", "bot.log");
  const stateFile = path.resolve(repoRoot, "system", "runtime-state.json");

  const adminUserIdValue = optionalNumber(telegram.admin_user_id);
  const adminUserId = typeof adminUserIdValue === "number" && adminUserIdValue > 0 ? adminUserIdValue : null;
  const defaultTimezone = stringOr(bot.default_timezone, "Asia/Tokyo").trim() || "Asia/Tokyo";
  const maintenanceIdleAfterMinutes = numberOr(maintenance.idle_after_minutes, 15);
  const tmpRetentionDays = Math.max(1, numberOr(maintenance.tmp_retention_days, 7));

  const config: AppConfig = {
    telegram: {
      botToken: stringOr(telegram.bot_token, ""),
      adminUserId,
      waitingMessage: (optionalString(telegram.waiting_message) || "").trim(),
      waitingMessageCandidates: asStringArray(telegram.waiting_message_candidates),
      waitingMessageRotationSeconds: numberOr(telegram.waiting_message_rotation_seconds, 5),
      inputMergeWindowSeconds: Math.max(0, numberOr(telegram.input_merge_window_seconds, 3)),
      menuPageSize: numberOr(telegram.menu_page_size, 8),
    },
    bot: {
      personaStyle: stringOr(bot.persona_style, ""),
      language: asLanguage(bot.language),
      defaultTimezone,
    },
    paths: {
      repoRoot,
      tmpDir,
      uploadSubdir,
      logFile,
      stateFile,
    },
    maintenance: {
      enabled: booleanOr(maintenance.enabled, true),
      idleAfterMs: Math.max(0, maintenanceIdleAfterMinutes) * 60 * 1000,
      tmpRetentionDays,
    },
    opencode: {
      baseUrl: stringOr(opencode.base_url, "http://127.0.0.1:4096").trim() || "http://127.0.0.1:4096",
    },
  };

  if (!config.telegram.botToken) {
    throw new Error(`Missing telegram.bot_token in ${configPath}`);
  }
  if (!isValidTimezone(config.bot.defaultTimezone)) {
    throw new Error(`Invalid bot.default_timezone in ${configPath}: ${config.bot.defaultTimezone}`);
  }
  if (!config.telegram.adminUserId) {
    throw new Error(`Missing telegram.admin_user_id in ${configPath}`);
  }

  return config;
}
