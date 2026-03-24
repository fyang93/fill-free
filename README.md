# Fill Free

[中文说明](README.zh-CN.md)

Fill Free is a local-first personal memory repo: save reusable facts and supporting files once, then use them again for forms, applications, and document prep.

## What To Use It For

- keep reusable personal info in `memory/`
- keep related files in `assets/`
- use `workspace/` as a temporary drop zone for files you want AI to sort or prepare
- retrieve existing notes quickly with `just` commands

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

## Project Layout

- `memory/`: committed AI-safe Markdown notes
- `assets/`: stored documents and attachments
- `workspace/`: temporary working area
- `index/`: generated local indexes

## Basic Workflow

1. Put reusable facts into a note under `memory/`.
2. Put related files into `workspace/` first if they still need sorting.
3. Move long-term files into `assets/` and link them from notes.
4. Run `just index` after adding, renaming, moving, or retagging notes.
5. Run `just check` to validate notes.

## Note Format

Notes live under `memory/` and use frontmatter like this:

```md
---
title: "Profile"
date: "2026-03-23"
tags: ["profile"]
aliases: ["personal info"]
---

My birthday is 1993-09-06.
```

Required fields: `title`, `date`, `tags`.

## Common Commands

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

Use these in a simple order:

1. `just find QUERY` or `just tag TAG`
2. `just list`
3. `just frontmatter NOTE` or `just body NOTE`
4. `just search PATTERN` if you need raw body text search

## Sensitive Data

Do not casually store highly sensitive values like passwords, API keys, private keys, recovery codes, credit card numbers, or CVV. Ordinary personal details can be stored when you explicitly want them remembered.

## Verify

```bash
just check
uv run pytest
```
