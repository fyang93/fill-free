# Fill Free

[中文说明](README.zh-CN.md)

Fill Free is a local-first repo for AI-managed personal memory. You tell AI what to remember, update, organize, or archive, and the repo stores reusable notes and linked files for later form filling, applications, and document prep.

## How You Use It

You usually do not write notes in `memory/` by hand.

- tell AI to remember or update reusable personal facts
- put files in `workspace/` and ask AI to organize them
- let AI move long-term files into `assets/` and link them from notes
- ask AI to retrieve existing information when you need it again

## Typical Requests

```text
Please remember that my birthday is 2000-01-01.
Update my profile: my current phone number is 13800000000.
I put my diploma in workspace/. Please organize it into memory.
These two files are my ID card front and back. Store them and link them in my profile.
Please organize the materials I need for this visa application.
```

By default, AI organizes files using filenames and your instructions. It does not read document contents unless you explicitly ask it to.

## What The Repo Stores

- `memory/`: committed AI-safe Markdown notes managed by the agent
- `assets/`: long-term stored files and attachments
- `workspace/`: temporary drop zone for files and intermediate outputs
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
```

## Commands

The CLI is mainly for retrieval and maintenance behind the skill:

```bash
just list
just find profile
just tag profile
just frontmatter memory/profile.md
just body memory/profile.md
just search passport
just index
just check
```

In normal use, ask AI first. These commands are most useful when you want to inspect stored notes, rebuild indexes, or validate the repo.

## Sensitive Data

Normal personal facts can be stored when you explicitly ask. For highly sensitive values such as passwords, API keys, private keys, recovery codes, credit card numbers, or CVV, AI should warn before storing them.

## Verify

```bash
just check
uv run pytest
```
