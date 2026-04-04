import { answerRepoQueryTask } from "operations/query/service";
import type { TaskHandler } from "./types";
import { sendUserReply } from "./shared";

export const queryAnswerFromRepoTaskHandler: TaskHandler = {
  name: "query.answer-from-repo",
  supports: (task) => task.domain === "query" && task.operation === "answer-from-repo",
  run: async ({ config, agentService, bot }, task) => {
    const output = await answerRepoQueryTask(config, task);
    await sendUserReply(agentService, bot, task, output.message);
    return { result: output.result };
  },
};
