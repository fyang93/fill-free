# The Defect Bot

[中文说明](README.zh-CN.md)

The Defect Bot is a local-first personal memory repo with a Telegram bot interface powered by OpenCode. It's not perfect, but free.

## How You Use It

You usually do not write notes in `memory/` by hand.

- tell AI to remember or update reusable personal facts
- put files in `tmp/` and ask AI to organize them
- let AI move long-term files into `assets/` and link them from notes
- ask AI to retrieve existing information when you need it again

## Typical Requests

```text
Please remember that my birthday is 2000-01-01.
Update my profile: my current phone number is 13800000000.
I put my diploma in tmp/. Please organize it into memory.
These two files are my ID card front and back. Store them and link them in my profile.
Please organize the materials I need for this visa application.
```

By default, AI organizes files using filenames and your instructions. It does not read document contents unless you explicitly ask it to.

## What The Repo Stores

- `memory/`: committed AI-safe Markdown notes
- `assets/`: long-term stored files and attachments
- `tmp/`: temporary drop zone for files and intermediate outputs
- `index/`: Telegram bot runtime state

## Setup

Requirements:

- `bun`
- `just`
- `fd`
- `ripgrep`

Install dependencies:

```bash
bun install
```

## OpenCode + Telegram Bot

Quick start:

1. Copy `config.toml.example` to `config.toml`
2. Fill in your Telegram bot config
3. Start the bot:

```bash
just serve
```

If OpenCode is already running on `127.0.0.1:4096`, the command reuses it.

Useful config:

- `telegram.language`: controls both UI text and conversation reply language (`zh` or `en`)
- `telegram.waiting_message`: initial in-progress message shown while a task is running
- `telegram.waiting_message_candidates`: optional list of replacement waiting messages rotated every 5 seconds
- `telegram.persona_style`: tune the bot's reply tone

## Telegram Bot

Commands:

- `/help`
- `/new`
- `/model`
- `/reminders`

Usage:

- send normal text to chat with the repo
- upload files to save them under `tmp/telegram/<date>/`
- add a caption to process uploaded files immediately
- ask for an existing repo file or image and the bot can send it back

## Commands

The top-level `justfile` is intentionally minimal:

```bash
just serve
```

For retrieval, prefer standard shell tools directly:

```bash
fd . memory
rg -n "樱桃|郭旸" memory
rg -n -C 2 "三井住友|SMBC" memory
```

In normal use, ask AI first. The repo now follows a minimal-tool philosophy similar to pi itself: keep the default surface area small, and rely on `fd`, `rg`, and direct file reads for most retrieval work. Frontmatter is still useful as lightweight structure, aliases, and summaries, but concrete answers should usually come from body search rather than a separate metadata index.

For lower-noise retrieval, keep each markdown note topic-focused and keep tags sparse. A good default is at most 3 tags per note, with separate notes such as `memory/profile.md` and `memory/banking.md` instead of a single catch-all file. Prefer semantic scope over fixed length limits: split notes when they start covering multiple stable retrieval domains, not just because they became longer.

## Sensitive Data

Normal personal facts can be stored when you explicitly ask. For highly sensitive values such as passwords, API keys, private keys, recovery codes, credit card numbers, or CVV, AI should warn before storing them.

