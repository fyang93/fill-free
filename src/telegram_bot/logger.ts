import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

let logFilePath = "logs/telegram-bot.log";

export function configureLogger(filePath: string): void {
  logFilePath = filePath;
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
