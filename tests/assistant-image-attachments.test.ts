import { describe, expect, test } from "bun:test";
import { executeAssistantActions } from "../src/bot/runtime/assistant-actions";

describe("assistant image handling", () => {
  test("keeps saved image paths text-first for the assistant runtime", async () => {
    let captured: any = null;
    const attachment = {
      mimeType: "image/jpeg",
      filename: "photo.jpg",
      url: "data:image/jpeg;base64,AAA",
    };
    const uploaded = {
      savedPath: "tmp/telegram/2026-04-17/photo.jpg",
      absolutePath: "/repo/tmp/telegram/2026-04-17/photo.jpg",
      originalName: "photo.jpg",
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      source: "photo",
    };

    const result = await executeAssistantActions({
      config: {} as any,
      agentService: {
        runAssistantTurn: async (input: any) => {
          captured = input;
          return {
            message: "已看到保存的图片文件。",
            usedNativeExecution: false,
            completedActions: [],
            files: [],
            attachments: [],
          };
        },
      } as any,
      ctx: { chat: { id: 1, type: "private" } } as any,
      requesterUserId: 1,
      uploadedFiles: [uploaded],
      attachments: [attachment],
      canDeliverOutbound: true,
      accessRole: "admin",
      userRequestText: "评价一下这张图片",
    });

    expect(captured.uploadedFiles).toEqual([uploaded]);
    expect(captured.attachments).toEqual([attachment]);
    expect(result.message).toBe("已看到保存的图片文件。");
  });
});
