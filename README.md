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

- `memory/`: committed AI-safe Markdown notes managed by `memory-agent`
- `assets/`: long-term stored files and attachments
- `tmp/`: temporary drop zone for files and intermediate outputs
- `index/`: generated local indexes used for retrieval

## Setup

Requirements:

- Python `3.11+`
- `uv`
- `just`
- `fd`
- `ripgrep`

Install dependencies:

```bash
uv sync
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

The CLI is mainly for retrieval and maintenance behind the skill:

```bash
just list
just list --paths 10
just find --top 3 profile
just find --paths --top 1 bank account
just frontmatter memory/profile.md
just body memory/profile.md
just search passport
just search --files passport
just search --context 2 --max-count 1 passport
just index
just check
```

In normal use, ask AI first. These commands are most useful when you want to inspect stored notes, rebuild indexes, or validate the repo.

A miss from `just find` does not prove there is no related note. `just find` only searches indexed metadata, including frontmatter `summary`, and accepts multiple space-separated terms such as `just find bank account`. Prefer `just find --top 3 ...` when you only need the best few candidates, and prefer `--paths` for downstream agent use because paths are shorter and less ambiguous than titles. Keep `summary` concise and body-descriptive so agents can avoid opening note bodies unnecessarily. `just frontmatter NOTE` now returns the compact metadata view with `title`, `tags`, `aliases`, and `summary`, which is the preferred low-token metadata read. Use `just list` to browse likely matches, then continue to `just search` before concluding that the repo does not have what you need. If you only need to know which notes mention something in the body, use `just search --files ...` before reading any body text. If you need a small body snippet, prefer `just search --context 2 --max-count 1 ...` before opening the full note body.

For lower-noise retrieval, keep each markdown note topic-focused and keep tags sparse. A good default is at most 3 tags per note, with separate notes such as `memory/profile.md` and `memory/banking.md` instead of a single catch-all file. Prefer semantic scope over fixed length limits: split notes when they start covering multiple stable retrieval domains, not just because they became longer. `body` is intentionally a higher-cost command; use it only after `find`, `list`, `frontmatter`, or `search --files` has already narrowed the target note. `just check` may emit advisory topic-sprawl warnings to help you decide when to split a note.

## Sensitive Data

Normal personal facts can be stored when you explicitly ask. For highly sensitive values such as passwords, API keys, private keys, recovery codes, credit card numbers, or CVV, AI should warn before storing them.

## Verify

```bash
just check
uv run pytest
```
