# The Defect Bot

[中文说明](README.zh-CN.md)

A local-first Telegram bot for managing personal information, organizing materials, helping fill forms from memory, and reminders.

## What it does

- manage and retrieve personal information
- organize materials and files
- help fill forms using remembered facts
- create and manage reminders

## Access levels

The bot has three practical permission levels:

- `allowed user`: may chat with the bot and ask non-sensitive informational questions. Repository content should be treated as read-only and privacy-restricted. Cannot read or extract private long-term memory, reminders, personal files, secrets, or other sensitive repository data. Cannot modify long-term memory, files, reminders-as-data, or runtime config.
- `trusted user`: may read and modify repository memory/files and other persistent data, including private long-term memory and reminder data. Still cannot request changes to `config.toml` or runtime configuration.
- `admin user`: effectively a trusted user plus admin-only operations. The admin can request `config.toml` / runtime config changes, receives startup and config-reload notices, and can use all commands.

Notes:

- `admin_user_id` is treated as trusted automatically at runtime, even if it is not repeated in `trusted_user_ids`.
- A `trusted user` does not need to also appear in `allowed_user_ids`.
- An `admin user` does not need to also appear in `trusted_user_ids` or `allowed_user_ids`.
- Users not listed in `allowed_user_ids`, `trusted_user_ids`, or as `admin_user_id` cannot access the bot.

## Setup

Use Nix or install dependencies manually.

### Option 1: Nix

If you use `direnv`, entering the repository will automatically activate the development environment.
In that case, you can usually run:

```bash
just install
```

If you do not use `direnv`, enter the Nix shell manually:

```bash
nix develop
just install
```

### Option 2: Manual

Install:

- `bun`
- `just`
- `fd`
- `ripgrep`

Then:

```bash
just install
```

## Usage

1. Copy `config.toml.example` to `config.toml`
2. Fill in your Telegram bot config
3. Start the bot

A typical setup is:

- `allowed_user_ids = [111111111]`
- `trusted_user_ids = [222222222]`
- `admin_user_id = 333333333`

If you only use trusted/admin users, `allowed_user_ids` may be empty.

```bash
just serve
```

If OpenCode is already running on `127.0.0.1:4096`, it will be reused.

## `config.toml` fields

### `[telegram]`

- `bot_token`: your Telegram bot token from BotFather.
- `allowed_user_ids`: Telegram user IDs allowed to talk to the bot in privacy-restricted read-only mode. They may ask general questions, but should not be allowed to read private memory, reminders, personal files, or secrets. May be empty if you only use trusted/admin users.
- `trusted_user_ids`: users allowed to read and modify memory, files, reminders, and other persistent repository data. Users listed here do not need to also appear in `allowed_user_ids`.
- `admin_user_id`: optional admin user ID. The admin is treated as trusted automatically, receives startup/config-reload notices, can change runtime config, and can use all commands. The admin does not need to also appear in `trusted_user_ids` or `allowed_user_ids`.
- `max_file_size_mb`: max upload size accepted by the bot.
- `persona_style`: optional reply style instruction for the assistant.
- `language`: default reply language, `zh` or `en`.
- `waiting_message`: temporary message shown while the bot is working.
- `waiting_message_candidates`: optional alternative waiting messages used for rotation.
- `waiting_message_rotation_ms`: how often to rotate waiting messages.
- `reminder_message_timeout_ms`: timeout for generated reminder wording.
- `menu_page_size`: number of items shown per Telegram menu page.

### `[paths]`

- `upload_subdir`: subdirectory under the repository `tmp/` directory for Telegram uploads.
- `log_file`: main bot log file.
- `state_file`: local state file path, usually `.telegram-state.json`.

Notes:

- The repository root is always the current repository root.
- The temporary working directory is always `tmp/` under the repository root.

### `[opencode]`

- `base_url`: OpenCode server URL.

### `[dreaming]`

These are internal tuning fields. For normal use, keep the defaults.

## Commands and session behavior

- `/help`: available to all authorized users.
- `/new`: available to allowed, trusted, and admin users. In private chats it resets that user's private session; in groups it resets the shared session for that group.
- `/model`: available to trusted and admin users.

Session isolation:

- private chats use one session per user;
- group and supergroup chats use one shared session per chat;
- recent-upload context follows the same scope as sessions.

Reminder delivery behavior:

- reminders store the owner user ID when applicable and deliver to that owner instead of broadcasting to all allowed users;
- expired one-time reminders are pruned on startup;
- when the idle dreaming loop actually changes reminders, tmp cleanup, or memory files, the admin receives a Telegram summary; if nothing changed, no dreaming notification is sent;
- reminder wording is generated with the configured persona style;
- one-time reminders pre-generate delivery text when created;
- recurring reminders only pre-generate the next pending delivery text, and only when the next notification is within a 24-hour prewarm window.

## Typical uses

- “Remember my passport number / address / bank info.”
- “Organize these materials for me.”
- “Use my saved info to help fill this form.”
- “Remind me tomorrow at 9am to submit this application.”
