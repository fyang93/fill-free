# The Defect Bot

[中文说明](README.zh-CN.md)

A local-first Telegram bot for personal memory, files, and reminders.

## What it does

- remember and retrieve personal information
- organize uploaded materials
- help with forms using saved facts
- create and manage reminders
- relay messages between authorized Telegram users

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
```

### 3. Start

```bash
just serve
```

## Telegram setup notes

- Every user who should receive direct bot messages must have started a private chat with the bot at least once.
- If you want to use the bot in group chats, open **BotFather** and turn **Group Privacy** off for the bot.

## Access levels

- `allowed user`: may chat with the bot and request reminders for themselves, but should not read or modify private long-term data
- `trusted user`: may read and modify memory, files, reminders, and other persistent data
- `admin user`: trusted user plus admin-only operations

Users not listed in `allowed_user_ids`, `trusted_user_ids`, or `admin_user_id` cannot access the bot.

## Main directories

- `memory/`: human-readable long-term notes
- `assets/`: files kept long-term
- `system/`: code-managed persistent data such as reminders and Telegram identity/state
- `tmp/`: temporary uploads and working files

## Basic usage examples

### Personal memory

- “Remember my passport number.”
- “What is my home address?”
- “Use my saved info to help fill this form.”

### Reminders

- “Remind me tomorrow at 9am to submit the application.”
- “Create a birthday reminder for my wife with reminders 2 weeks before, 1 week before, 1 day before, and same day.”

### Multi-user usage

Assume:

- `111111111` is an allowed user
- `222222222` is a trusted user
- `333333333` is the admin

Examples:

- trusted/admin user: “Send this to @kyogokuame: dinner is ready.”
- trusted/admin user: “Remind @kyogokuame tomorrow at 8pm to take medicine.”
- in a group chat, reply to someone’s message and say: “Tell them I’ll arrive in 10 minutes.”

## Commands

- `/help`
- `/new`
- `/model` (trusted/admin)
