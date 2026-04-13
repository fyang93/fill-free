import type { TaskHandler } from "./types";

export const rulesTaskHandler: TaskHandler = {
  name: "rules",
  supports: (task) => task.domain === "rules",
  run: async () => ({ result: { skipped: true, reason: "legacy-rules-store-disabled" } }),
};
