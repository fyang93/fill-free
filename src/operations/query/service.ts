import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "scheduling/app/types";
import { matchInvertedIndex, touchInvertedIndexTerms } from "operations/context/inverted-index";
import type { TaskRecord } from "support/tasks/runtime/store";

function summarizeMemoryProfile(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && /[:：]/.test(line))
    .slice(0, 5)
    .map((line) => line.replace(/^-\s*/, ""));
}

async function answerFromIndexedPaths(config: AppConfig, requestText: string): Promise<{ message: string; result: Record<string, unknown> } | null> {
  const { matchedTerms, paths } = await matchInvertedIndex(config.paths.repoRoot, requestText);
  if (paths.length === 0) return null;
  const existing = await Promise.all(paths.slice(0, 3).map(async (filePath) => ({
    filePath,
    text: await readFile(path.join(config.paths.repoRoot, filePath), "utf8").catch(() => ""),
  })));
  const usable = existing.filter((item) => item.text.trim());
  if (usable.length === 0) return null;
  await touchInvertedIndexTerms(config.paths.repoRoot, matchedTerms, { confirm: true });
  const primary = usable[0];
  const facts = summarizeMemoryProfile(primary.text);
  return {
    message: [
      `${matchedTerms[0] || "相关条目"} 的相关记录在 ${primary.filePath}。`,
      ...facts,
    ].slice(0, 5).join("\n"),
    result: { answered: true, strategy: "inverted-index", matchedTerms, matchedPaths: usable.map((item) => item.filePath) },
  };
}

// Repo query execution capability for query tasks. This is an implementation module,
// not a separate task taxonomy.
export async function answerRepoQueryTask(config: AppConfig, task: TaskRecord): Promise<{ message: string; result: Record<string, unknown> }> {
  const requestText = typeof task.payload.requestText === "string" ? task.payload.requestText.trim() : "";
  if (!requestText) {
    return {
      message: "查询任务缺少 requestText，无法继续。",
      result: { answered: false, reason: "missing-request-text" },
    };
  }

  const indexed = await answerFromIndexedPaths(config, requestText);
  if (indexed) return indexed;

  return {
    message: "我已接手查询，但当前倒排索引里还没有可直接确认的相关记录。请给我更明确的稳定标识（例如用户名、精确名称或相关文件路径），或等系统后续补全索引后再查。",
    result: { answered: false, reason: "no-index-hit" },
  };
}
