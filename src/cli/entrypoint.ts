import { addPendingAuthorization, appendCliLogLine, CliOutput, initializeRepoCli, logCliInvocation, summarizeArgsForLog } from "cli/runtime";
import { handleEventMutation, handleEventsCreate, handleEventsGet, handleEventsList } from "cli/commands/events";
import { handleTelegramResolveRecipient, handleTelegramScheduleMessage, handleTelegramSendFile, handleTelegramSendMessage } from "cli/commands/telegram";
import { handleUsersAddRule, handleUsersGet, handleUsersList, handleUsersSetAccess, handleUsersSetPersonPath, handleUsersSetRules, handleUsersSetTimezone } from "cli/commands/users";

export async function runRepoCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const rawDomain = argv[0]?.trim() || "";
  const rawArgs = argv[1] || "{}";
  const args = JSON.parse(rawArgs) as Record<string, unknown>;
  const context = await initializeRepoCli(args);
  const command = rawDomain.trim();
  const commandStartedAt = Date.now();

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
      case "events:list":
      case "schedules:list": await handleEventsList(context); break;
      case "events:get":
      case "schedules:get": await handleEventsGet(context); break;
      case "events:create":
      case "schedules:create": await handleEventsCreate(context); break;
      case "events:update":
      case "schedules:update": await handleEventMutation(context, "update"); break;
      case "events:delete":
      case "schedules:delete": await handleEventMutation(context, "delete"); break;
      case "events:pause":
      case "schedules:pause": await handleEventMutation(context, "pause"); break;
      case "events:resume":
      case "schedules:resume": await handleEventMutation(context, "resume"); break;
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
      process.stdout.write(`${JSON.stringify(error.value, null, 2)}\n`);
      process.exit(0);
    }
    appendCliLogLine(context.config, "ERROR", `repo cli failed command=${command} raw=${rawDomain} ms=${Date.now() - commandStartedAt} message=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
