import { addPendingAuthorization, appendCliLogLine, CliOutput, emitCliTerminalLine, initializeRepoCli, logCliInvocation, summarizeArgsForLog } from "cli/runtime";
import { handleEventMutation, handleEventsCreate, handleEventsGet, handleEventsList } from "cli/commands/events";
import { handleTelegramResolveRecipient, handleTelegramScheduleMessage, handleTelegramSendFile, handleTelegramSendMessage } from "cli/commands/telegram";
import { handleUsersAddRule, handleUsersGet, handleUsersList, handleUsersSetAccess, handleUsersSetPersonPath, handleUsersSetRules, handleUsersSetTimezone } from "cli/commands/users";

function summarizeCliResult(command: string, value: unknown): { level: "INFO" | "WARN"; message: string } {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const summary = typeof record?.summary === "string" && record.summary.trim() ? record.summary.trim() : "";
  const error = typeof record?.error === "string" && record.error.trim() ? record.error.trim() : "";
  const reason = typeof record?.reason === "string" && record.reason.trim() ? record.reason.trim() : "";
  const status = typeof record?.status === "string" && record.status.trim() ? record.status.trim() : "";
  const changed = typeof record?.changed === "boolean" ? record.changed : undefined;
  const delivered = record?.delivered === true;
  const scheduled = record?.scheduled === true;
  const eventCount = Array.isArray(record?.events) ? record.events.length : undefined;

  if (summary) {
    return { level: record?.ok === false ? "WARN" : "INFO", message: `${command}: ${summary}` };
  }
  if (record?.ok === false) {
    const detail = error || reason || status || "failed";
    return { level: "WARN", message: `${command}: ${detail}` };
  }
  if (delivered) {
    const target = typeof record?.recipientLabel === "string" && record.recipientLabel.trim() ? record.recipientLabel.trim() : String(record?.recipientId ?? "recipient");
    return { level: "INFO", message: `${command}: delivered to ${target}` };
  }
  if (scheduled) {
    const target = typeof record?.recipientLabel === "string" && record.recipientLabel.trim() ? record.recipientLabel.trim() : String(record?.recipientId ?? "recipient");
    const sendAt = typeof record?.sendAt === "string" && record.sendAt.trim() ? ` at ${record.sendAt.trim()}` : "";
    return { level: "INFO", message: `${command}: scheduled for ${target}${sendAt}` };
  }
  if (typeof changed === "boolean") {
    return { level: "INFO", message: `${command}: ${changed ? "changed" : "no change"}` };
  }
  if (typeof eventCount === "number") {
    return { level: "INFO", message: `${command}: ${eventCount} event(s)` };
  }
  if (status) {
    return { level: "INFO", message: `${command}: ${status}` };
  }
  return { level: "INFO", message: `${command}: done` };
}

export async function runRepoCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const rawDomain = argv[0]?.trim() || "";
  const rawArgs = argv[1] || "{}";
  const args = JSON.parse(rawArgs) as Record<string, unknown>;
  const context = await initializeRepoCli(args);
  const command = rawDomain.trim();
  const commandStartedAt = Date.now();

  emitCliTerminalLine(context.config, "INFO", `${command || "unknown-command"}: start`);
  await logCliInvocation(context.config, command, rawDomain, args);

  try {
    switch (command) {
      case "users:list": await handleUsersList(context); break;
      case "users:get": await handleUsersGet(context); break;
      case "users:set-access": await handleUsersSetAccess(context); break;
      case "users:set-timezone": await handleUsersSetTimezone(context); break;
      case "users:set-person-path": await handleUsersSetPersonPath(context); break;
      case "users:add-rule": await handleUsersAddRule(context); break;
      case "users:set-rules": await handleUsersSetRules(context); break;
      case "events:list": await handleEventsList(context); break;
      case "events:get": await handleEventsGet(context); break;
      case "events:create": await handleEventsCreate(context); break;
      case "events:update": await handleEventMutation(context, "update"); break;
      case "events:delete": await handleEventMutation(context, "delete"); break;
      case "events:pause": await handleEventMutation(context, "pause"); break;
      case "events:resume": await handleEventMutation(context, "resume"); break;
      case "auth:add-pending": await addPendingAuthorization(context); break;
      case "telegram:resolve-recipient": await handleTelegramResolveRecipient(context); break;
      case "telegram:send-message": await handleTelegramSendMessage(context); break;
      case "telegram:send-file": await handleTelegramSendFile(context); break;
      case "telegram:schedule-message": await handleTelegramScheduleMessage(context); break;
      default: context.output({ ok: false, error: `unsupported-command:${command}` });
    }
  } catch (error) {
    if (error instanceof CliOutput) {
      appendCliLogLine(context.config, "INFO", `repo cli complete command=${command} raw=${rawDomain} ms=${Date.now() - commandStartedAt} output=${summarizeArgsForLog(error.value)}`);
      const summary = summarizeCliResult(command, error.value);
      emitCliTerminalLine(context.config, summary.level, summary.message);
      process.stdout.write(`${JSON.stringify(error.value, null, 2)}\n`);
      process.exit(0);
    }
    appendCliLogLine(context.config, "ERROR", `repo cli failed command=${command} raw=${rawDomain} ms=${Date.now() - commandStartedAt} message=${error instanceof Error ? error.message : String(error)}`);
    emitCliTerminalLine(context.config, "ERROR", `${command}: exception ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
