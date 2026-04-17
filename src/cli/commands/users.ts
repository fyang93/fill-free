import { existsSync } from "node:fs";
import path from "node:path";
import { clearStoredUserAccessLevel, setStoredUserAccessLevel } from "bot/operations/access/roles";
import { loadUsers, resolveUser } from "bot/operations/context/store";
import type { RepoCliContext } from "cli/runtime";

function normalizeRulesInput(value: unknown): string[] | undefined {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => typeof item === "string" && item.trim() ? item.trim() : undefined)
    .filter((item): item is string => Boolean(item));
  const deduped = Array.from(new Set(items));
  return deduped.length > 0 ? deduped : undefined;
}

function resolveEffectiveUser(context: RepoCliContext): { userId?: number; username?: string; displayName?: string; effectiveUserId?: number } {
  const { userId, username, displayName, resolvedUserId } = context.resolveUserLookup();
  return { userId, username, displayName, effectiveUserId: resolvedUserId ?? userId };
}

function updateUserField(context: RepoCliContext, field: "timezone" | "personPath", value: string): { effectiveUserId: number; user: Record<string, unknown>; changed: boolean } {
  const { nowIso, output } = context;
  context.requireAdminRequester();
  const { effectiveUserId } = resolveEffectiveUser(context);
  if (!effectiveUserId) {
    output({ ok: false, error: `userId-required-for-${field}` });
    throw new Error(`unreachable: ${field} output returned`);
  }
  const previous = resolveUser(context.config.paths.repoRoot, effectiveUserId) || {};
  const next = updateUserDoc(context, effectiveUserId, (current) => ({
    ...current,
    [field]: value,
    updatedAt: nowIso(),
  }));
  return { effectiveUserId: effectiveUserId as number, user: next, changed: JSON.stringify(previous) !== JSON.stringify(next) };
}

function updateUserDoc(context: RepoCliContext, effectiveUserId: number, mutate: (previous: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  const { usersDoc, writeJson } = context;
  const doc = usersDoc();
  const key = String(effectiveUserId);
  const previous = doc.users[key] || {};
  const next = mutate(previous);
  doc.users[key] = next;
  writeJson("system/users.json", doc);
  return next;
}

export async function handleUsersList(context: RepoCliContext): Promise<void> {
  context.requireAdminRequester();
  context.output({ ok: true, users: loadUsers(context.config.paths.repoRoot) });
}

export async function handleUsersGet(context: RepoCliContext): Promise<void> {
  context.requireAdminRequester();
  const { resolvedUserId } = context.resolveUserLookup();
  context.output({ ok: true, userId: resolvedUserId, user: resolvedUserId ? resolveUser(context.config.paths.repoRoot, resolvedUserId) || null : null });
}

export async function handleUsersSetAccess(context: RepoCliContext): Promise<void> {
  const { args, cleanText, output } = context;
  context.requireAdminRequester();
  const { username, displayName, resolvedUserId } = context.resolveUserLookup();
  const accessLevel = cleanText(args.accessLevel);
  if (!resolvedUserId) {
    output({ ok: false, error: "user-not-resolved" });
    return;
  }
  if (accessLevel === undefined || accessLevel === null || accessLevel === "" || accessLevel === "none" || accessLevel === "clear") {
    const changed = await clearStoredUserAccessLevel(context.config, resolvedUserId as number, { username, displayName, lastSeenAt: cleanText(args.lastSeenAt) });
    output({ ok: true, changed, userId: resolvedUserId, accessLevel: null });
  }
  if (accessLevel !== "allowed" && accessLevel !== "trusted") output({ ok: false, error: "invalid-access-level" });
  const changed = await setStoredUserAccessLevel(context.config, resolvedUserId as number, accessLevel as "allowed" | "trusted", { username, displayName, lastSeenAt: cleanText(args.lastSeenAt) });
  output({ ok: true, changed, userId: resolvedUserId, accessLevel });
}

export async function handleUsersSetTimezone(context: RepoCliContext): Promise<void> {
  const value = context.cleanText(context.args.timezone);
  if (!value) context.output({ ok: false, error: "missing-timezone" });
  const result = updateUserField(context, "timezone", value as string);
  context.output({ ok: true, userId: result.effectiveUserId, changed: result.changed, user: result.user });
}

export async function handleUsersSetPersonPath(context: RepoCliContext): Promise<void> {
  const { args, cleanText, output, nowIso } = context;
  context.requireAdminRequester();
  const { effectiveUserId } = resolveEffectiveUser(context);
  if (!effectiveUserId) {
    output({ ok: false, error: "userId-required-for-personPath" });
    return;
  }

  const rawPath = cleanText(args.personPath);
  if (rawPath === undefined) {
    output({ ok: false, error: "missing-personPath" });
    return;
  }

  if (rawPath === "clear" || rawPath === "none") {
    const previous = resolveUser(context.config.paths.repoRoot, effectiveUserId) || {};
    const next = updateUserDoc(context, effectiveUserId, (current) => {
      const { personPath: _removed, ...rest } = current;
      return { ...rest, updatedAt: nowIso() };
    });
    output({ ok: true, changed: JSON.stringify(previous) !== JSON.stringify(next), userId: effectiveUserId, user: next });
    return;
  }

  if (path.isAbsolute(rawPath)) {
    output({ ok: false, error: "personPath-must-be-relative" });
    return;
  }
  if (!/^memory\/people\/(?:.+\/)?README\.md$/i.test(rawPath)) {
    output({ ok: false, error: "invalid-personPath" });
    return;
  }
  const absolutePath = path.join(context.config.paths.repoRoot, rawPath);
  if (!existsSync(absolutePath)) {
    output({ ok: false, error: "personPath-not-found" });
    return;
  }

  const previous = resolveUser(context.config.paths.repoRoot, effectiveUserId) || {};
  const next = updateUserDoc(context, effectiveUserId, (current) => ({
    ...current,
    personPath: rawPath,
    updatedAt: nowIso(),
  }));
  output({ ok: true, changed: JSON.stringify(previous) !== JSON.stringify(next), userId: effectiveUserId, user: next });
}

export async function handleUsersAddRule(context: RepoCliContext): Promise<void> {
  const { args, cleanText, nowIso, output } = context;
  context.requireAdminRequester();
  const { effectiveUserId } = resolveEffectiveUser(context);
  if (!effectiveUserId) {
    output({ ok: false, error: "userId-required-for-rule" });
    return;
  }
  const rule = cleanText(args.rule);
  if (!rule) output({ ok: false, error: "missing-rule" });
  const previous = resolveUser(context.config.paths.repoRoot, effectiveUserId) || {};
  const next = updateUserDoc(context, effectiveUserId, (current) => {
    const existing = normalizeRulesInput(current.rules) || [];
    const merged = Array.from(new Set([...existing, rule as string]));
    return { ...current, rules: merged, updatedAt: nowIso() };
  });
  output({ ok: true, changed: JSON.stringify(previous) !== JSON.stringify(next), userId: effectiveUserId, user: next });
}

export async function handleUsersSetRules(context: RepoCliContext): Promise<void> {
  const { args, nowIso, output } = context;
  context.requireAdminRequester();
  const { effectiveUserId } = resolveEffectiveUser(context);
  if (!effectiveUserId) {
    output({ ok: false, error: "userId-required-for-rules" });
    return;
  }
  const normalizedRules = normalizeRulesInput(args.rules);
  if (normalizedRules == null && !Array.isArray(args.rules)) output({ ok: false, error: "missing-rules" });
  const previous = resolveUser(context.config.paths.repoRoot, effectiveUserId) || {};
  const next = updateUserDoc(context, effectiveUserId, (current) => ({
    ...current,
    rules: normalizedRules || [],
    updatedAt: nowIso(),
  }));
  output({ ok: true, changed: JSON.stringify(previous) !== JSON.stringify(next), userId: effectiveUserId, user: next });
}
