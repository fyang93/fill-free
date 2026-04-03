# The Defect Bot

[中文说明](README.zh-CN.md)

A local-first Telegram bot for personal memory, files, reminders, and lightweight relay workflows.

It runs on the pi SDK, with bot-local pi configuration under `.pi/bot/`.

## What it does

- remember and retrieve personal facts
- organize uploaded files and materials
- create and manage reminders
- send messages or reminders to authorized users or known group chats

## Quick start

```bash
cp config.toml.example config.toml
cp .env.example .env
just install
just serve
```

## Configuration

Fill in at least:

- `telegram.bot_token`
- `telegram.allowed_user_ids` and/or `telegram.trusted_user_ids`
- optional `telegram.admin_user_id`
- `OPENROUTER_API_KEY` in `.env`

Typical setup:

```toml
[telegram]
bot_token = "YOUR_TELEGRAM_BOT_TOKEN"
allowed_user_ids = [111111111]
trusted_user_ids = [222222222]
admin_user_id = 333333333

[bot]
language = "zh"
persona_style = "Speak like the Defect from Slay the Spire."
reminder_message_timeout_ms = 60000
prompt_task_timeout_ms = 60000
default_timezone = "Asia/Tokyo"
```

Useful optional settings:

- `bot.reminder_message_timeout_ms`: timeout for reminder message generation, default `60000`
- `bot.prompt_task_timeout_ms`: timeout for normal prompt handling, default `60000`
- `bot.default_timezone`: fallback timezone used when the user has not explicitly provided one

The bot uses project-local pi files under `.pi/bot/`:

- `.pi/bot/models.json`: bot model/provider definitions
- `.pi/bot/settings.json`: bot default provider/model
- `.pi/bot/mcp.json`: bot MCP server configuration

The committed default setup uses OpenRouter via `OPENROUTER_API_KEY`.

For watch mode during development:

```bash
bun run telegram:dev
```

## Telegram prerequisites

- Every user who should receive direct bot messages must have started a private chat with the bot at least once.
- If you want to use the bot in group chats, open **BotFather** and turn **Group Privacy** off for the bot.

## Access levels

- `allowed user`: may chat with the bot and use basic personal features
- `trusted user`: may read and modify memory, files, reminders, and other persistent data
- `admin user`: trusted user plus admin-only operations

Users not listed in `allowed_user_ids`, `trusted_user_ids`, or `admin_user_id` cannot access the bot.

The admin may also temporarily allow a `@username`. In that case, the user must send the bot a private message before the temporary authorization expires so the bot can add them to `allowed_user_ids`.

## Main directories

- `memory/`: human-readable long-term notes
- `assets/`: files kept long-term
- `system/`: code-managed state such as reminders and Telegram identity/state
- `tmp/`: temporary uploads and working files

## Example usage

- “Remember my passport number.”
- “What is my home address?”
- “Remind me tomorrow at 9am to submit the application.”
- “Send this to @kyogokuame: dinner is ready.”
- “Send this to the family group.”

## Commands

- `/help`
- `/new`
- `/model` (trusted/admin)
- `/dream` (admin)
