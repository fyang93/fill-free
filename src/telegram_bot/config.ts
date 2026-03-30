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

  const config: AppConfig = {
    telegram: {
      botToken: asString(telegram.bot_token),
      allowedUserId: asNumber(telegram.allowed_user_id, 0),
      pollingTimeoutSec: asNumber(telegram.polling_timeout_sec, 20),
      pollingIntervalMs: asNumber(telegram.polling_interval_ms, 300),
      maxFileSizeMb: asNumber(telegram.max_file_size_mb, 20),
      personaStyle: asString(telegram.persona_style),
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
  if (!config.telegram.allowedUserId) {
    throw new Error(`Missing telegram.allowed_user_id in ${configPath}`);
  }

  return config;
}
