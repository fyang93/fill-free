import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import {
  accessLevelRank,
  canCreateSchedules,
  canRequesterCreateEventTargets,
  canUseFiles,
  hasAccessLevel,
  isAddressedToBot,
  isPendingAuthorizationClaimInteraction,
} from "../src/bot/operations/access/control";

describe("file access guard", () => {
  test("allowed, trusted, and admin users can use temporary file uploads", () => {
    expect(canUseFiles("admin")).toBe(true);
    expect(canUseFiles("trusted")).toBe(true);
    expect(canUseFiles("allowed")).toBe(true);
    expect(canUseFiles("none")).toBe(false);
  });

  test("allowed, trusted, and admin users can create schedules", () => {
    expect(canCreateSchedules("admin")).toBe(true);
    expect(canCreateSchedules("trusted")).toBe(true);
    expect(canCreateSchedules("allowed")).toBe(true);
    expect(canCreateSchedules("none")).toBe(false);
  });

  test("access levels compare by rank", () => {
    expect(accessLevelRank("none")).toBeLessThan(accessLevelRank("allowed"));
    expect(accessLevelRank("allowed")).toBeLessThan(accessLevelRank("trusted"));
    expect(accessLevelRank("trusted")).toBeLessThan(accessLevelRank("admin"));
    expect(hasAccessLevel("admin", "trusted")).toBe(true);
    expect(hasAccessLevel("trusted", "allowed")).toBe(true);
    expect(hasAccessLevel("allowed", "trusted")).toBe(false);
    expect(hasAccessLevel("none", "allowed")).toBe(false);
  });
});

describe("schedule target permissions", () => {
  test("allowed user can target self or chats, but not other users", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-access-guard-"));
    await mkdir(path.join(repoRoot, "system"), { recursive: true });
    await writeFile(path.join(repoRoot, "system", "users.json"), JSON.stringify({
      users: {
        "2": { accessLevel: "allowed", timezone: "Asia/Tokyo" },
      },
    }, null, 2) + "\n", "utf8");

    const config = { telegram: { adminUserId: 1 }, paths: { repoRoot } } as any;
    expect(canRequesterCreateEventTargets(config, 2, [{ targetKind: "user", targetId: 2 }])).toBe(true);
    expect(canRequesterCreateEventTargets(config, 2, [{ targetKind: "chat", targetId: -1001 }])).toBe(true);
    expect(canRequesterCreateEventTargets(config, 2, [{ targetKind: "user", targetId: 1 }])).toBe(false);
  });
});

describe("bot addressing detection", () => {
  test("group reply_to_message to bot counts as addressed", () => {
    const ctx = {
      chat: { type: "group" },
      message: {
        reply_to_message: {
          from: { id: 42, username: "defect_bot" },
        },
      },
    } as any;

    expect(isAddressedToBot(ctx, "defect_bot", 42)).toBe(true);
  });

  test("group external_reply to bot counts as addressed", () => {
    const ctx = {
      chat: { type: "supergroup" },
      message: {
        external_reply: {
          origin: {
            sender_user: { id: 42, username: "defect_bot" },
          },
        },
      },
    } as any;

    expect(isAddressedToBot(ctx, "defect_bot", 42)).toBe(true);
  });

  test("plain group message without mention or reply is not addressed", () => {
    const ctx = {
      chat: { type: "group" },
      message: { text: "hello" },
    } as any;

    expect(isAddressedToBot(ctx, "defect_bot", 42)).toBe(false);
  });

  test("pending authorization claim requires private chat or addressing the bot in groups", () => {
    const privateCtx = {
      chat: { type: "private" },
      me: { id: 42, username: "defect_bot" },
      message: { text: "hello" },
    } as any;
    const mentionedGroupCtx = {
      chat: { type: "group" },
      me: { id: 42, username: "defect_bot" },
      message: {
        text: "@defect_bot hi",
        entities: [{ type: "mention", offset: 0, length: 11 }],
      },
    } as any;
    const unrelatedGroupCtx = {
      chat: { type: "group" },
      me: { id: 42, username: "defect_bot" },
      message: { text: "hello everyone" },
    } as any;

    expect(isPendingAuthorizationClaimInteraction(privateCtx)).toBe(true);
    expect(isPendingAuthorizationClaimInteraction(mentionedGroupCtx)).toBe(true);
    expect(isPendingAuthorizationClaimInteraction(unrelatedGroupCtx)).toBe(false);
  });
});
