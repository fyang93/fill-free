import { describe, expect, test } from "bun:test";
import { buildProjectSystemPrompt, buildPrompt } from "../src/support/ai/prompt";
import { extractAiTurnResultFromText } from "../src/support/ai/response";

describe("responder persona stability prompt", () => {
  test("responder system prompt explicitly forbids drifting into generic assistant tone", () => {
    const prompt = buildProjectSystemPrompt("冷静、简洁、带一点稳定的机械感", "responder");
    expect(prompt).toContain("Keep the configured user-facing persona consistent on every turn.");
    expect(prompt).toContain("Do not drift into a generic assistant tone.");
    expect(prompt).toContain("All user-facing replies, including clarifications, confirmations, and short follow-ups, must follow the configured persona.");
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
    expect(prompt).toContain("Every user-facing reply, including clarification questions, confirmations, and short follow-ups, must still follow the configured persona.");
    expect(prompt).toContain("Use answerMode='needs-clarification' when a durable or executable request is missing required details");
    expect(prompt).toContain("vague time phrases such as afternoon, evening, later, sometime tomorrow, or after work are not precise enough");
    expect(prompt).toContain("Do not default to 14:00 or any other guessed time");
    expect(prompt).toContain("If the provided context includes a recent clarification and the current user message looks like the missing detail, combine them and continue from that earlier request instead of asking the same clarification again.");
  });

  test("response parser keeps needs-clarification answer mode", () => {
    const parsed = extractAiTurnResultFromText('{"message":"请告诉我下午具体几点。","answerMode":"needs-clarification"}');
    expect(parsed.answerMode).toBe("needs-clarification");
    expect(parsed.message).toContain("具体几点");
  });
});
