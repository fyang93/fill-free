import { describe, expect, test } from "bun:test";
import { executeAssistantActions } from "../src/bot/runtime/assistant-actions";

describe("assistant image handling", () => {
  test("passes current-turn attachments through to the assistant runtime", async () => {
    let captured: any = null;
    const attachment = {
      mimeType: "image/jpeg",
      filename: "photo.jpg",
      url: "data:image/jpeg;base64,AAA",
    };

    const result = await executeAssistantActions({
      config: {} as any,
      agentService: {
        runAssistantTurn: async (input: any) => {
          captured = input;
          return {
            message: "已评价图片。",
            usedNativeExecution: false,
            completedActions: [],
            files: [],
            attachments: [],
          };
        },
      } as any,
      ctx: { chat: { id: 1, type: "private" } } as any,
      requesterUserId: 1,
      attachments: [attachment],
      canDeliverOutbound: true,
      accessRole: "admin",
      userRequestText: "评价一下这张图片",
    });

    expect(captured.attachments).toEqual([attachment]);
    expect(result.message).toBe("已评价图片。");
  });
});
