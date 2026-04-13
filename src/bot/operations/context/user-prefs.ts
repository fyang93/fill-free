import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "bot/app/types";
import { invalidateContextStoreCache, resolveUser } from "bot/operations/context/store";

function usersFilePath(repoRoot: string): string {
  return path.join(repoRoot, "system", "users.json");
}

async function readUsersDocument(repoRoot: string): Promise<{ users: Record<string, unknown> }> {
  try {
    const parsed = JSON.parse(await readFile(usersFilePath(repoRoot), "utf8")) as { users?: Record<string, unknown> };
    return { users: parsed.users && typeof parsed.users === "object" ? parsed.users : {} };
  } catch {
    return { users: {} };
  }
}

export function getUserPreferredLanguage(config: AppConfig, userId: number | undefined): "zh-CN" | "en" {
  if (!userId) return config.bot.language;
  const user = resolveUser(config.paths.repoRoot, userId);
  return (user?.preferredLanguage as "zh-CN" | "en") ?? config.bot.language;
}

export async function setUserPreferredLanguage(
  config: AppConfig,
  userId: number,
  language: "zh-CN" | "en",
): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const repoRoot = config.paths.repoRoot;
  const filePath = usersFilePath(repoRoot);
  const document = await readUsersDocument(repoRoot);
  const key = String(userId);
  const current = document.users[key] && typeof document.users[key] === "object"
    ? document.users[key] as Record<string, unknown>
    : {};
  const next: Record<string, unknown> = {
    ...current,
    preferredLanguage: language,
    updatedAt: new Date().toISOString(),
  };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  document.users[key] = next;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  invalidateContextStoreCache(filePath);
}
