import { describe, expect, test } from "bun:test";
import { ActiveConversationTasks } from "../src/bot/runtime/conversations/active";

describe("active conversation task interruption", () => {
  test("merged follow-up interruption does not force a sad reaction", async () => {
    const reactions: Array<{ chatId: number; messageId: number; emoji: string }> = [];
    const tasks = new ActiveConversationTasks(
      { api: { deleteMessage: async () => {} } } as any,
      { abortCurrentSession: async () => {} } as any,
      () => {},
      async (chatId, messageId, emoji) => {
        reactions.push({ chatId, messageId, emoji });
      },
    );

    tasks.set("user:1", {
      id: 1,
      userId: 1,
      scopeKey: "user:1",
      scopeLabel: "user 1",
      chatId: 1,
      sourceMessageId: 100,
      cancelled: false,
    });

    await tasks.interrupt("merged follow-up input 101", "user:1", { reactionEmoji: null });
    expect(reactions).toEqual([]);
  });
});
