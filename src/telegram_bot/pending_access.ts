import type { AppConfig } from "./types";
import { addAllowedUserIdToConfig } from "./access_grants";
import type { PromptAccessRole } from "./agent/prompt";
import type { PromptPendingAuthorizationDraft } from "./agent/types";
import { persistState, rememberPendingAuthorization, consumePendingAllowedAuthorization, pruneExpiredPendingAuthorizations } from "./state";

export const PENDING_AUTH_ADMIN_ONLY_FACT = "Temporary authorization is admin-only.";

export async function storePendingAuthorizations(
  config: AppConfig,
  pendingAuthorizations: PromptPendingAuthorizationDraft[],
  requesterUserId: number | undefined,
  accessRole: PromptAccessRole,
): Promise<{ created: string[]; clarifications: string[] }> {
  const created: string[] = [];
  const clarifications: string[] = [];
  if (pendingAuthorizations.length === 0) return { created, clarifications };
  if (accessRole !== "admin" || !requesterUserId) {
    clarifications.push(PENDING_AUTH_ADMIN_ONLY_FACT);
    return { created, clarifications };
  }

  let changed = false;
  for (const item of pendingAuthorizations) {
    const username = item.username.trim().replace(/^@+/, "").toLowerCase();
    const expiresAt = item.expiresAt.trim();
    const parsed = Date.parse(expiresAt);
    if (!username || !Number.isFinite(parsed) || parsed <= Date.now()) continue;
    rememberPendingAuthorization({
      kind: "allowed",
      username,
      createdBy: requesterUserId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(parsed).toISOString(),
    });
    changed = true;
    created.push(`Temporary allowed access prepared for @${username} until ${new Date(parsed).toISOString()}. Ask them to send the bot a private message within that time so they can be added to the allowed users list.`);
  }
  if (changed) await persistState(config.paths.stateFile);
  return { created, clarifications };
}

export async function grantPendingAllowedAccessIfMatched(config: AppConfig, user: { id?: number; username?: string } | null | undefined): Promise<{ granted: boolean; username?: string; changed?: boolean }> {
  const userId = typeof user?.id === "number" ? user.id : undefined;
  if (!userId) return { granted: false };
  const granted = consumePendingAllowedAuthorization(user?.username);
  if (!granted) return { granted: false };
  const changed = await addAllowedUserIdToConfig(userId);
  if (!config.telegram.allowedUserIds.includes(userId)) config.telegram.allowedUserIds.push(userId);
  await persistState(config.paths.stateFile);
  return { granted: true, username: granted.username, changed };
}

export async function pruneExpiredPendingAuthorizationsFromState(config: AppConfig): Promise<number> {
  const removed = pruneExpiredPendingAuthorizations();
  if (removed > 0) await persistState(config.paths.stateFile);
  return removed;
}
