# The Defect Bot

[中文说明](README.zh-CN.md)

A local-first Telegram bot for managing personal information, organizing materials, helping fill forms from memory, and reminders.

## What it does

- manage and retrieve personal information
- organize materials and files
- help fill forms using remembered facts
- create and manage reminders

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

```bash
just serve
```

If OpenCode is already running on `127.0.0.1:4096`, it will be reused.

## `config.toml` fields

### `[telegram]`

- `bot_token`: your Telegram bot token from BotFather.
- `allowed_user_ids`: Telegram user IDs allowed to talk to the bot.
- `trusted_user_ids`: users allowed to modify memory, files, and other persistent repository data.
- `admin_user_id`: optional admin user ID. Only this user receives startup greetings and can use admin-only commands like `/new` and `/model`.
- `max_file_size_mb`: max upload size accepted by the bot.
- `persona_style`: optional reply style instruction for the assistant.
- `language`: default reply language, `zh` or `en`.
- `waiting_message`: temporary message shown while the bot is working.
- `waiting_message_candidates`: optional alternative waiting messages used for rotation.
- `waiting_message_rotation_ms`: how often to rotate waiting messages.
- `reminder_message_timeout_ms`: timeout for generated reminder wording.
- `menu_page_size`: number of items shown per Telegram menu page.

### `[paths]`

- `repo_root`: repository root used by the bot.
- `tmp_dir`: temporary working directory for uploaded files.
- `upload_subdir`: subdirectory under `tmp_dir` for Telegram uploads.
- `log_file`: main bot log file.
- `state_file`: local state file path, usually `.telegram-state.json`.

### `[opencode]`

- `base_url`: OpenCode server URL.

### `[dreaming]`

These are internal tuning fields. For normal use, keep the defaults.

## Typical uses

- “Remember my passport number / address / bank info.”
- “Organize these materials for me.”
- “Use my saved info to help fill this form.”
- “Remind me tomorrow at 9am to submit this application.”
