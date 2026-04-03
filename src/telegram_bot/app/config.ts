import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "@iarna/toml";
import type { AppConfig } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
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
    .map((item) => asNumber(item, NaN))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asLanguage(value: unknown): "zh" | "en" {
  const normalized = asString(value, "zh").trim().toLowerCase();
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
  const dreaming = asRecord(parsed.dreaming);
  const repoRoot = path.resolve(process.cwd());
  const tmpDir = path.resolve(repoRoot, "tmp");
  const uploadSubdir = "telegram";
  const logFile = path.resolve(repoRoot, "logs", "telegram-bot.log");
  const stateFile = path.resolve(repoRoot, "system", "telegram-state.json");

  const allowedUserIds = asNumberArray(telegram.allowed_user_ids);
  const trustedUserIds = asNumberArray(telegram.trusted_user_ids);
  const adminUserIdValue = asNumber(telegram.admin_user_id, NaN);
  const adminUserId = Number.isFinite(adminUserIdValue) && adminUserIdValue > 0 ? adminUserIdValue : null;
  const defaultTimezone = asString(bot.default_timezone, "Asia/Tokyo").trim() || "Asia/Tokyo";

  const config: AppConfig = {
    telegram: {
      botToken: asString(telegram.bot_token),
      allowedUserIds,
      trustedUserIds,
      adminUserId,
      maxFileSizeMb: asNumber(telegram.max_file_size_mb, 20),
    },
    bot: {
      personaStyle: asString(bot.persona_style),
      language: asLanguage(bot.language),
      waitingMessage: asString(bot.waiting_message, "机宝启动中..."),
      waitingMessageCandidates: asStringArray(bot.waiting_message_candidates),
      waitingMessageRotationMs: asNumber(bot.waiting_message_rotation_ms, 5000),
      reminderMessageTimeoutMs: asNumber(bot.reminder_message_timeout_ms, 60000),
      promptTaskTimeoutMs: asNumber(bot.prompt_task_timeout_ms, 60000),
      menuPageSize: asNumber(bot.menu_page_size, 8),
      defaultTimezone,
    },
    paths: {
      repoRoot,
      tmpDir,
      uploadSubdir,
      logFile,
      stateFile,
    },
    dreaming: {
      enabled: asBoolean(dreaming.enabled, true),
      idleAfterMs: asNumber(dreaming.idle_after_ms, 15 * 60 * 1000),
      checkIntervalMs: asNumber(dreaming.check_interval_ms, 60 * 1000),
      timeoutMs: asNumber(dreaming.timeout_ms, 5 * 60 * 1000),
    },
  };

  if (!config.telegram.botToken) {
    throw new Error(`Missing telegram.bot_token in ${configPath}`);
  }
  if (!isValidTimezone(config.bot.defaultTimezone)) {
    throw new Error(`Invalid bot.default_timezone in ${configPath}: ${config.bot.defaultTimezone}`);
  }
  if (
    config.telegram.allowedUserIds.length === 0
    && config.telegram.trustedUserIds.length === 0
    && !config.telegram.adminUserId
  ) {
    throw new Error(
      `Configure at least one accessible user via telegram.allowed_user_ids, telegram.trusted_user_ids, or telegram.admin_user_id in ${configPath}`,
    );
  }

  return config;
}
