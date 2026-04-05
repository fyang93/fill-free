import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const opencodeConfig = JSON.parse(readFileSync(path.join(import.meta.dir, "..", "opencode.json"), "utf8")) as any;

describe("opencode agent restrictions", () => {
  test("responder and greeter agents deny web and tool permissions in opencode config", () => {
    expect(opencodeConfig.agent?.responder?.tools?.mcp).toBe(false);
    expect(opencodeConfig.agent?.responder?.tools?.websearch).toBe(false);
    expect(opencodeConfig.agent?.responder?.tools?.["exa*"]).toBe(false);
    expect(opencodeConfig.agent?.responder?.permission?.websearch).toBe("deny");
    expect(opencodeConfig.agent?.responder?.permission?.webfetch).toBe("deny");
    expect(opencodeConfig.agent?.greeter?.tools?.mcp).toBe(false);
    expect(opencodeConfig.agent?.greeter?.tools?.["exa*"]).toBe(false);
    expect(opencodeConfig.agent?.greeter?.permission?.websearch).toBe("deny");
  });
});
