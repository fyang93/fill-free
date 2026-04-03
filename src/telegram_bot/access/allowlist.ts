import { readFile, writeFile } from "node:fs/promises";
import { parse, stringify, type JsonMap } from "@iarna/toml";
import { DEFAULT_CONFIG_PATH } from "../app/config_runtime";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : [];
}

export async function addAllowedUserIdToConfig(userId: number, configPath = DEFAULT_CONFIG_PATH): Promise<boolean> {
  const raw = await readFile(configPath, "utf8");
  const parsed = asRecord(parse(raw));
  const telegram = asRecord(parsed.telegram);
  const allowed = normalizeNumberArray(telegram.allowed_user_ids);
  if (allowed.includes(userId)) return false;
  telegram.allowed_user_ids = [...allowed, userId];
  parsed.telegram = telegram;
  await writeFile(configPath, stringify(parsed as JsonMap), "utf8");
  return true;
}
