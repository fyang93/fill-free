# Mamory

[中文说明](README.zh-CN.md)

Local-first notes and profile management for AI workflows.

This repository keeps committed notes in AI-safe Markdown, stores real private values in a local `secrets.toml`, and exposes a small `just` command surface so agents can retrieve information with low token cost.

## Principles

- `memory/` stores committed Markdown notes only
- real values stay in local `secrets.toml`
- notes use placeholders like `{{education.high_school.name}}`
- indexes in `index/` are lightweight and public inside the repo
- only `just body` increases local usage ranking
- final answers expand placeholders locally with `just expand`

## Repository Layout

```text
.
├── .agents/skills/notes-agent/SKILL.md
├── .local/
├── index/
├── memory/
├── workspace/
├── justfile
├── pyproject.toml
├── secrets.toml.example
└── src/notes_agent/
```

- `memory/`: committed AI-safe Markdown notes
- `index/`: generated note and tag indexes
- `.local/`: ignored local state such as usage counts
- `workspace/`: local drop zone for user-managed files and external skills

## Requirements

- `uv`
- Python `3.14`
- `just`
- `fd`
- `ripgrep`

If you use Nix, the provided `flake.nix` sets up the shell.

## Setup

```bash
uv sync
cp secrets.toml.example secrets.toml
```

Fill `secrets.toml` locally. Do not commit it.

## Note Format

Notes live under `memory/` and use frontmatter like this:

```md
---
title: "High School"
date: "2026-03-23"
tags: ["education", "profile"]
aliases: ["school"]
summary: "Optional local summary in the note file."
---

My high school is {{education.high_school.name}}.
```

Writing rules used by the repo-local skill:

- body defaults to Chinese
- title defaults to Chinese
- tags use English `kebab-case`

## Commands

```bash
just index
just list [N|all]
just find QUERY
just tag TAG
just frontmatter NOTE
just body NOTE
just search PATTERN
just secrets-add [NOTE]
just secrets-set KEY
just secrets-fill NOTE
just expand
just check
```

## Recommended Retrieval Order

Use the cheapest command first:

1. `just find QUERY`
2. `just tag TAG`
3. `just list` / `just list 10` / `just list 100`
4. `just frontmatter NOTE`
5. `just body NOTE`
6. `just search PATTERN`

## Secret Workflow

1. Write or update notes with placeholders
2. Run `just secrets-add [NOTE]` to register missing keys
3. Fill normal values with `just secrets-set KEY` or `just secrets-fill NOTE`
4. Produce an answer that still contains placeholders
5. Pipe the final text into `just expand`

Example:

```bash
printf 'Your high school is {{education.high_school.name}}.\n' | just expand
```

## Sensitive Data Rules

The repo-local skill forbids asking for or filling highly sensitive values through the AI workflow.

Examples:

- API keys
- tokens
- passwords
- private keys
- recovery codes
- credit card numbers
- CVV

Those values must be entered manually outside the normal AI flow.

## External Skills

This repo does not implement PDF or spreadsheet filling directly.

Instead:

- this repo provides retrieval and placeholder expansion
- external skills handle file parsing and writing
- missing information should be confirmed with the user

## Verification

Run the full test suite:

```bash
uv run pytest
```
