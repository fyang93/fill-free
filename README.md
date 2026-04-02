# The Defect Bot

[中文说明](README.zh-CN.md)

A local-first Telegram bot for personal memory, files, and reminders.

## Core features

- remember and retrieve personal information
- organize uploaded materials and files
- help with forms using saved facts
- create and manage reminders
- send messages and reminders to authorized users or known group chats

## Quick start

### 1. Install dependencies

Use Nix, or install these manually:

- `bun`
- `just`
- `fd`
- `ripgrep`

Then run:

```bash
just install
```

### 2. Configure the bot

Copy the example config:

```bash
cp config.toml.example config.toml
```

Fill in at least:

- `bot_token`
- `allowed_user_ids` and/or `trusted_user_ids`
- optional `admin_user_id`

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

### 3. Start

```bash
just serve
```

## Telegram setup notes

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
- `system/`: code-managed persistent data such as reminders and Telegram identity/state
- `tmp/`: temporary uploads and working files

## Example usage

- “Remember my passport number.”
- “What is my home address?”
- “Use my saved info to help fill this form.”
- “Remind me tomorrow at 9am to submit the application.”
- “Send this to @kyogokuame: dinner is ready.”
- “Remind @kyogokuame tomorrow at 8pm to take medicine.”
- “Send this to the family group.”
- “Remind the project group tomorrow at 10am.”

## Commands

- `/help`
- `/new`
- `/model` (trusted/admin)
