import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "scheduling/app/types";
import { loadUsers, resolveUser, resolveUserByUsername, type UserRecord } from "operations/context/store";

export type AccessLevel = "trusted" | "allowed" | "none";
export type StoredUserRole = Exclude<AccessLevel, "none">;

type UserRolePatch = {
  role?: StoredUserRole;
  username?: string;
  displayName?: string;
  updatedBy?: number;
  lastSeenAt?: string;
};

function normalizeUsername(value: string | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
  return normalized || undefined;
}

function usersFilePath(repoRoot: string): string {
  return path.join(repoRoot, "system", "users.json");
}

function normalizeStoredRole(value: unknown): StoredUserRole | undefined {
  return value === "trusted" || value === "allowed" ? value : undefined;
}

async function readUsersDocument(repoRoot: string): Promise<{ users: Record<string, unknown> }> {
  try {
    const parsed = JSON.parse(await readFile(usersFilePath(repoRoot), "utf8")) as { users?: Record<string, unknown> };
    return { users: parsed.users && typeof parsed.users === "object" ? parsed.users : {} };
  } catch {
    return { users: {} };
  }
}

function buildDisplayName(username: string | undefined, existing: UserRecord | undefined, current: Record<string, unknown>): string | undefined {
  if (typeof current.displayName === "string" && current.displayName.trim()) return current.displayName.trim();
  if (existing?.displayName?.trim()) return existing.displayName.trim();
  if (username?.trim()) return `@${username.trim().replace(/^@+/, "")}`;
  return undefined;
}

export function accessLevelForUser(config: AppConfig, userId: number | undefined): AccessLevel {
  if (typeof userId !== "number") return "none";
  if (config.telegram.adminUserId === userId) return "trusted";
  const role = normalizeStoredRole(resolveUser(config.paths.repoRoot, userId)?.role);
  return role || "none";
}

export function listAuthorizedUserIds(config: AppConfig): number[] {
  const ids = new Set<number>();
  if (config.telegram.adminUserId) ids.add(config.telegram.adminUserId);
  for (const [userId, user] of Object.entries(loadUsers(config.paths.repoRoot))) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId)) continue;
    if (normalizeStoredRole(user.role)) ids.add(numericUserId);
  }
  return Array.from(ids);
}

export async function setStoredUserRole(
  config: AppConfig,
  userId: number,
  role: StoredUserRole,
  patch: UserRolePatch = {},
): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const repoRoot = config.paths.repoRoot;
  const filePath = usersFilePath(repoRoot);
  const document = await readUsersDocument(repoRoot);
  const key = String(userId);
  const current = document.users[key] && typeof document.users[key] === "object" ? document.users[key] as Record<string, unknown> : {};
  const existing = resolveUser(repoRoot, userId);
  const username = normalizeUsername(patch.username)
    ? normalizeUsername(patch.username)
    : existing?.username || (typeof current.username === "string" ? current.username.trim() : undefined);
  const displayName = buildDisplayName(username, existing, current);
  const now = new Date().toISOString();
  const next: Record<string, unknown> = {
    ...current,
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
    ...(patch.lastSeenAt ? { lastSeenAt: patch.lastSeenAt } : {}),
    role,
    updatedAt: now,
    ...(typeof patch.updatedBy === "number" ? { roleUpdatedBy: String(patch.updatedBy) } : {}),
  };
  if (JSON.stringify(next) === JSON.stringify(current)) return false;
  document.users[key] = next;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return true;
}

export async function clearStoredUserRole(
  config: AppConfig,
  userId: number,
  patch: Omit<UserRolePatch, "role"> = {},
): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const repoRoot = config.paths.repoRoot;
  const filePath = usersFilePath(repoRoot);
  const document = await readUsersDocument(repoRoot);
  const key = String(userId);
  const current = document.users[key] && typeof document.users[key] === "object" ? document.users[key] as Record<string, unknown> : {};
  const existing = resolveUser(repoRoot, userId);
  const username = normalizeUsername(patch.username)
    ? normalizeUsername(patch.username)
    : existing?.username || (typeof current.username === "string" ? current.username.trim() : undefined);
  const displayName = buildDisplayName(username, existing, current);
  const now = new Date().toISOString();
  const { role: _role, ...rest } = current;
  const next: Record<string, unknown> = {
    ...rest,
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
    ...(patch.lastSeenAt ? { lastSeenAt: patch.lastSeenAt } : {}),
    updatedAt: now,
    ...(typeof patch.updatedBy === "number" ? { roleUpdatedBy: String(patch.updatedBy) } : {}),
  };
  if (JSON.stringify(next) === JSON.stringify(current)) return false;
  document.users[key] = next;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return true;
}

export async function setStoredUserRoles(
  config: AppConfig,
  entries: Array<{ userId: number; role: StoredUserRole; patch?: UserRolePatch }>,
): Promise<{ changedUserIds: number[]; unchangedUserIds: number[] }> {
  const changedUserIds: number[] = [];
  const unchangedUserIds: number[] = [];
  for (const entry of entries) {
    const changed = await setStoredUserRole(config, entry.userId, entry.role, entry.patch || {});
    if (changed) changedUserIds.push(entry.userId);
    else unchangedUserIds.push(entry.userId);
  }
  return { changedUserIds, unchangedUserIds };
}

export async function clearStoredUserRoles(
  config: AppConfig,
  entries: Array<{ userId: number; patch?: Omit<UserRolePatch, "role"> }>,
): Promise<{ changedUserIds: number[]; unchangedUserIds: number[] }> {
  const changedUserIds: number[] = [];
  const unchangedUserIds: number[] = [];
  for (const entry of entries) {
    const changed = await clearStoredUserRole(config, entry.userId, entry.patch || {});
    if (changed) changedUserIds.push(entry.userId);
    else unchangedUserIds.push(entry.userId);
  }
  return { changedUserIds, unchangedUserIds };
}

export function resolveStoredUserId(config: AppConfig, input: { userId?: number; username?: string }): number | null {
  if (Number.isInteger(input.userId) && (input.userId || 0) > 0) return input.userId || null;
  const username = normalizeUsername(input.username);
  if (!username) return null;
  const match = resolveUserByUsername(config.paths.repoRoot, username);
  return match ? Number(match[0]) : null;
}
