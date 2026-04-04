import { storePendingAuthorizations } from "operations/access/authorizations";
import { clearStoredUserRole, resolveStoredUserId, setStoredUserRole } from "operations/access/roles";
import type { TaskHandler } from "./types";
import { readTrimmedPayloadString } from "./shared";

export const accessGrantTemporaryTaskHandler: TaskHandler = {
  name: "access.grant-temporary",
  supports: (task) => task.domain === "access" && task.operation === "grant-temporary",
  run: async ({ config }, task) => {
    const username = readTrimmedPayloadString(task, "username");
    const expiresAt = readTrimmedPayloadString(task, "expiresAt");
    if (!username || !expiresAt || !task.source?.requesterUserId) return { result: { skipped: true, reason: "invalid-access-payload" } };
    await storePendingAuthorizations(config, [{ username, expiresAt }], task.source.requesterUserId, "admin");
    return { result: { granted: true, username } };
  },
};

export const accessSetRoleTaskHandler: TaskHandler = {
  name: "access.set-role",
  supports: (task) => task.domain === "access" && task.operation === "set-role",
  run: async ({ config }, task) => {
    if (!task.source?.requesterUserId || task.source.requesterUserId !== config.telegram.adminUserId) {
      return { result: { skipped: true, reason: "admin-only" } };
    }
    const requestedRole = readTrimmedPayloadString(task, "role").toLowerCase();
    const username = readTrimmedPayloadString(task, "username") || readTrimmedPayloadString(task, "targetUsername") || undefined;
    const payloadUserId = Number(task.payload.userId);
    const subjectUserId = task.subject?.kind === "user" ? Number(task.subject.id) : NaN;
    const userId = resolveStoredUserId(config, {
      userId: Number.isInteger(subjectUserId) ? subjectUserId : Number.isInteger(payloadUserId) ? payloadUserId : undefined,
      username,
    });
    if (!userId) return { result: { skipped: true, reason: "target-not-resolved" } };
    if (userId === config.telegram.adminUserId) return { result: { skipped: true, reason: "cannot-change-admin" } };
    if (requestedRole === "allowed" || requestedRole === "trusted") {
      const changed = await setStoredUserRole(config, userId, requestedRole, { username, updatedBy: task.source.requesterUserId });
      return { result: { changed, userId, role: requestedRole } };
    }
    if (requestedRole === "none" || requestedRole === "remove" || requestedRole === "revoke") {
      const changed = await clearStoredUserRole(config, userId, { username, updatedBy: task.source.requesterUserId });
      return { result: { changed, userId, role: "none" } };
    }
    return { result: { skipped: true, reason: "invalid-role" } };
  },
};
