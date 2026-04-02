import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./types";
import { loadConfig } from "./config";
import { logger } from "./logger";

export const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "config.toml");

export type ConfigReloadResult = {
  warnings: string[];
  reloadedKeys: string[];
  restartRequiredKeys: string[];
};

function equalStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function equalNumberArray(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function diffConfigKeys(before: AppConfig, after: AppConfig): string[] {
  const changed: string[] = [];
  if (before.telegram.botToken !== after.telegram.botToken) changed.push("telegram.bot_token");
  if (!equalNumberArray(before.telegram.allowedUserIds, after.telegram.allowedUserIds)) changed.push("telegram.allowed_user_ids");
  if (!equalNumberArray(before.telegram.trustedUserIds, after.telegram.trustedUserIds)) changed.push("telegram.trusted_user_ids");
  if (before.telegram.adminUserId !== after.telegram.adminUserId) changed.push("telegram.admin_user_id");
  if (before.telegram.maxFileSizeMb !== after.telegram.maxFileSizeMb) changed.push("telegram.max_file_size_mb");
  if (before.bot.personaStyle !== after.bot.personaStyle) changed.push("bot.persona_style");
  if (before.bot.language !== after.bot.language) changed.push("bot.language");
  if (before.bot.waitingMessage !== after.bot.waitingMessage) changed.push("bot.waiting_message");
  if (!equalStringArray(before.bot.waitingMessageCandidates, after.bot.waitingMessageCandidates)) changed.push("bot.waiting_message_candidates");
  if (before.bot.waitingMessageRotationMs !== after.bot.waitingMessageRotationMs) changed.push("bot.waiting_message_rotation_ms");
  if (before.bot.reminderMessageTimeoutMs !== after.bot.reminderMessageTimeoutMs) changed.push("bot.reminder_message_timeout_ms");
  if (before.bot.promptTaskTimeoutMs !== after.bot.promptTaskTimeoutMs) changed.push("bot.prompt_task_timeout_ms");
  if (before.bot.menuPageSize !== after.bot.menuPageSize) changed.push("bot.menu_page_size");
  if (before.bot.defaultTimezone !== after.bot.defaultTimezone) changed.push("bot.default_timezone");
  if (before.opencode.baseUrl !== after.opencode.baseUrl) changed.push("opencode.base_url");
  if (before.dreaming.enabled !== after.dreaming.enabled) changed.push("dreaming.enabled");
  if (before.dreaming.idleAfterMs !== after.dreaming.idleAfterMs) changed.push("dreaming.idle_after_ms");
  if (before.dreaming.checkIntervalMs !== after.dreaming.checkIntervalMs) changed.push("dreaming.check_interval_ms");
  if (before.dreaming.timeoutMs !== after.dreaming.timeoutMs) changed.push("dreaming.timeout_ms");
  return changed;
}

export function applyReloadedConfig(target: AppConfig, next: AppConfig): ConfigReloadResult {
  const warnings: string[] = [];
  const requestedChanges = diffConfigKeys(target, next);
  const restartRequiredKeys: string[] = [];

  if (target.telegram.botToken !== next.telegram.botToken) {
    warnings.push("telegram.bot_token changed but requires process restart; keeping the current runtime token");
    restartRequiredKeys.push("telegram.bot_token");
    next.telegram.botToken = target.telegram.botToken;
  }
  target.telegram = { ...next.telegram };
  target.bot = { ...next.bot };
  target.paths = { ...next.paths };
  target.opencode = { ...next.opencode };
  target.dreaming = { ...next.dreaming };

  const reloadedKeys = requestedChanges.filter((key) => !restartRequiredKeys.includes(key));
  return { warnings, reloadedKeys, restartRequiredKeys };
}

export function startConfigWatcher(
  configPath: string,
  config: AppConfig,
  onReload: (config: AppConfig, result: ConfigReloadResult) => Promise<void> | void,
): FSWatcher {
  const dir = path.dirname(configPath);
  const basename = path.basename(configPath);
  let timer: NodeJS.Timeout | null = null;
  let reloading = false;

  const scheduleReload = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (reloading) return;
      reloading = true;
      try {
        const next = loadConfig(configPath);
        const result = applyReloadedConfig(config, next);
        await logger.info(`reloaded config from ${configPath}`);
        for (const warning of result.warnings) {
          await logger.warn(`config reload warning: ${warning}`);
        }
        await onReload(config, result);
      } catch (error) {
        await logger.warn(`config reload failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        reloading = false;
      }
    }, 250);
  };

  return watch(dir, (_eventType, filename) => {
    if (!filename) {
      scheduleReload();
      return;
    }
    if (filename.toString() === basename) {
      scheduleReload();
    }
  });
}
