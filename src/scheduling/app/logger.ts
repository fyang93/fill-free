import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

let logFilePath = "logs/bot.log";

export async function configureLogger(filePath: string): Promise<void> {
  logFilePath = filePath;
  try {
    await mkdir(path.dirname(logFilePath), { recursive: true });
    await writeFile(logFilePath, "", "utf8");
  } catch {
    // ignore log reset failures
  }
}

async function writeLine(level: string, message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  if (level === "ERROR") {
    console.error(line.trimEnd());
  } else {
    console.log(line.trimEnd());
  }
  try {
    await mkdir(path.dirname(logFilePath), { recursive: true });
    await appendFile(logFilePath, line, "utf8");
  } catch {
    // ignore file logging failures
  }
}

export const logger = {
  info(message: string) {
    return writeLine("INFO", message);
  },
  warn(message: string) {
    return writeLine("WARN", message);
  },
  error(message: string) {
    return writeLine("ERROR", message);
  },
};
