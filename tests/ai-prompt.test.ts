import { describe, expect, test } from "bun:test";
import { buildProjectSystemPrompt, buildPrompt } from "../src/support/ai/prompt";

describe("responder persona stability prompt", () => {
  test("responder system prompt explicitly forbids drifting into generic assistant tone", () => {
    const prompt = buildProjectSystemPrompt("冷静、简洁、带一点稳定的机械感", "responder");
    expect(prompt).toContain("Keep the configured user-facing persona consistent on every turn.");
    expect(prompt).toContain("Do not drift into a generic assistant tone.");
  });

  test("responder turn prompt reinforces persona stability in long conversations", () => {
    const prompt = buildPrompt(
      "帮我查一下提醒",
      [],
      "Chinese",
      "Asia/Tokyo",
      "冷静、简洁、带一点稳定的机械感",
      undefined,
      "admin",
      undefined,
      "Asia/Tokyo",
    );
    expect(prompt).toContain("Keep the configured persona stable across turns.");
    expect(prompt).toContain("Do not drift into a generic default assistant tone");
    expect(prompt).toContain("Preserve persona as tone and wording texture");
  });
});
