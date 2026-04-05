import { describe, expect, test } from "bun:test";
import { publishResponderFirstReply, type ActiveConversationTask } from "../src/roles/responder";

describe("responder first reply delivery", () => {
  test("sends the responder reply as a new message before removing the waiting placeholder", async () => {
    const calls: string[] = [];
    const ctx = {
      reply: async (text: string) => {
        calls.push(`reply:${text}`);
        return { message_id: 2 };
      },
      api: {
        deleteMessage: async (chatId: number, messageId: number) => {
          calls.push(`delete:${chatId}:${messageId}`);
        },
      },
    } as any;

    const task: ActiveConversationTask = {
      id: 1,
      scopeKey: "user:1",
      scopeLabel: "user:1",
      chatId: 1,
      sourceMessageId: 10,
      waitingMessageId: 11,
      cancelled: false,
    };

    await publishResponderFirstReply(ctx, task, "好的，今天 21:00 提醒你。\n");

    expect(calls).toEqual([
      "reply:好的，今天 21:00 提醒你。\n",
      "delete:1:11",
    ]);
  });

  test("still sends the responder reply when there is no waiting placeholder", async () => {
    const calls: string[] = [];
    const ctx = {
      reply: async (text: string) => {
        calls.push(`reply:${text}`);
        return { message_id: 2 };
      },
      api: {
        deleteMessage: async (_chatId: number, _messageId: number) => {
          calls.push("delete");
        },
      },
    } as any;

    const task: ActiveConversationTask = {
      id: 1,
      scopeKey: "user:1",
      scopeLabel: "user:1",
      chatId: 1,
      sourceMessageId: 10,
      cancelled: false,
    };

    await publishResponderFirstReply(ctx, task, "收到");

    expect(calls).toEqual(["reply:收到"]);
  });
});
