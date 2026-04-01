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

function asLanguage(value: unknown): "zh" | "en" {
  const normalized = asString(value, "zh").trim().toLowerCase();
  return normalized === "en" ? "en" : "zh";
}

export function loadConfig(configPath = path.resolve(process.cwd(), "config.toml")): AppConfig {
  const raw = readFileSync(configPath, "utf8");
  const parsed = asRecord(parse(raw));

  const telegram = asRecord(parsed.telegram);
  const paths = asRecord(parsed.paths);
  const opencode = asRecord(parsed.opencode);
  const repoRoot = path.resolve(process.cwd(), asString(paths.repo_root, "."));
  const tmpDirValue = asString(paths.tmp_dir, asString(paths.workspace_dir, "tmp"));
  const tmpDir = path.resolve(repoRoot, tmpDirValue);
  const uploadSubdir = asString(paths.upload_subdir, "telegram");
  const logFile = path.resolve(repoRoot, asString(paths.log_file, "logs/telegram-bot.log"));

  const allowedUserIds = asNumberArray(telegram.allowed_user_ids);
  const trustedUserIds = asNumberArray(telegram.trusted_user_ids);
  const mainUserIdValue = asNumber(telegram.main_user_id, NaN);
  const mainUserId = Number.isFinite(mainUserIdValue) && mainUserIdValue > 0 ? mainUserIdValue : null;

  const config: AppConfig = {
    telegram: {
      botToken: asString(telegram.bot_token),
      allowedUserIds,
      trustedUserIds,
      mainUserId,
      pollingTimeoutSec: asNumber(telegram.polling_timeout_sec, 20),
      pollingIntervalMs: asNumber(telegram.polling_interval_ms, 300),
      maxFileSizeMb: asNumber(telegram.max_file_size_mb, 20),
      personaStyle: asString(telegram.persona_style),
      language: asLanguage(telegram.language),
      waitingMessage: asString(telegram.waiting_message, "机宝启动中..."),
      waitingMessageCandidates: asStringArray(telegram.waiting_message_candidates),
      waitingMessageRotationMs: asNumber(telegram.waiting_message_rotation_ms, 5000),
      reminderMessageTimeoutMs: asNumber(telegram.reminder_message_timeout_ms, 60000),
      menuPageSize: asNumber(telegram.menu_page_size, 8),
    },
    paths: {
      repoRoot,
      tmpDir,
      uploadSubdir,
      logFile,
    },
    opencode: {
      baseUrl: asString(opencode.base_url, "http://127.0.0.1:4096"),
    },
  };

  if (!config.telegram.botToken) {
    throw new Error(`Missing telegram.bot_token in ${configPath}`);
  }
  if (config.telegram.allowedUserIds.length === 0) {
    throw new Error(`Missing telegram.allowed_user_ids in ${configPath}`);
  }

  return config;
}
