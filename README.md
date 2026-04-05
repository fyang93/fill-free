# The Defect Bot

[中文说明](README.zh-CN.md)

A local-first Telegram bot for personal memory, files, reminders, and lightweight relay workflows.

It runs through a local OpenCode server, keeps canonical state in the repository, and treats Telegram as a platform adapter rather than the center of the architecture.

## What it does

- remember and retrieve personal facts
- organize uploaded files and materials
- create and manage reminders
- send messages or reminders to authorized users or known group chats
- let the admin manage durable user roles through the bot

## Architecture

The bot is organized as a small layered system: interaction, scheduling, roles, support, operations, and records.

```text
Interaction
  receive and deliver user messages
  |
  v
Scheduling
  coordinate loops, sessions, and timing
  |
  +-- fast lane / responder
  |     small-context quick reply candidate
  |
  +-- slow lane / executor
  |     full planning and final reply candidate
  |     |
  |     +--> Operations
  |     |      domain logic and reminders/access/...
  |     |      |
  |     |      +--> Records
  |     |             canonical state
  |     |
  |     +--> Arbiter
  |            publish the first safe visible result
  |
  +-- Maintainer
         cleanup and repair
         |
         +--> Operations
```
The conversation path now uses an asynchronous race:

- **fast lane / responder** runs with narrow injected context and optimizes TTFT
- **slow lane / executor** starts concurrently on the same task and can produce either a direct answer, a clarification, or the final execution-backed reply
- **arbiter** publishes whichever lane first produces a safe user-visible result
- if the fast lane says `needs-execution`, the slow lane continues and can publish the final reply directly
- there is no separate callback stage in the main reply flow anymore

### Conversation scoping

Short-term conversational context is kept in OpenCode sessions by scope:

- **private chat** -> one session per user
- **group / supergroup** -> one session per chat

Long-term facts, access roles, reminders, and structured rules do **not** rely on model session history. They live in repository state such as `system/users.json`, `system/chats.json`, `system/rules.json`, and reminder data.

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
- `telegram.admin_user_id`

Typical setup:

```toml
[telegram]
bot_token = "YOUR_TELEGRAM_BOT_TOKEN"
admin_user_id = 333333333
waiting_message = "Thinking..."
waiting_message_candidates = ["Still thinking...", "Almost there..."]
waiting_message_rotation_seconds = 5
input_merge_window_seconds = 3
menu_page_size = 8

[bot]
language = "zh"
persona_style = "Speak like the Defect from Slay the Spire."
default_timezone = "Asia/Tokyo"

[maintenance]
enabled = true
idle_after_minutes = 15

[opencode]
base_url = "http://127.0.0.1:4096"
```

Useful optional settings:

- `telegram.menu_page_size`: Telegram inline menu page size
- `telegram.input_merge_window_seconds`: short window for merging follow-up text/files into the same in-flight turn
- `telegram.waiting_message` / `telegram.waiting_message_candidates`: Telegram waiting UI text; if `waiting_message` is empty, no waiting message is shown
- `bot.default_timezone`: fallback timezone used when the user has not explicitly provided one
- `maintenance.idle_after_minutes`: run maintenance after this many idle minutes
- `[opencode].base_url`: local OpenCode server address

## Telegram prerequisites

- Every user who should receive direct bot messages must have started a private chat with the bot at least once.
- If you want to use the bot in group chats, open **BotFather** and turn **Group Privacy** off for the bot.

## Access levels

- `allowed user`: may chat with the bot and use basic personal features
- `trusted user`: may read and modify memory, files, reminders, and other persistent data
- `admin user`: trusted user plus admin-only operations

The admin may also temporarily allow a `@username`. After that, the user only needs to interact with the bot before the temporary authorization expires so the system can link the account and grant access. This can be a private chat, an `@bot` mention in a group, or a reply to the bot in a group.

## Example usage

- “Remember my passport number.”
- “What is my home address?”
- “Remind me tomorrow at 9am to submit the application.”
- “Send this to @someone: dinner is ready.”
- “Send this to the family group.”
- “Set @someone to trusted.”

## Commands

- `/new`
- `/model` (trusted/admin)

## Testing

```bash
bun run test
bun run test:nl
bun run test:nl-live
just test
```

The regression suite covers deterministic storage behavior and live natural-language flows, including reminder CRUD, rules persistence, access-role changes, memory keyword indexing, maintainer keyword backfill, and timezone-aware reminder phrasing.
