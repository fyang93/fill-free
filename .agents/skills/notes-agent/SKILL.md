---
name: notes-agent
description: Use when working inside this notes repository to retrieve markdown notes through the just CLI, manage local secret aliases, or prepare answers that may need final secret expansion.
---

# Notes Agent

## Overview

This repository stores AI-safe markdown in `memory/`, lightweight indexes in `index/`, and real local values in `secrets.toml`.

Use the CLI instead of ad-hoc file scanning so retrieval stays cheap and predictable.

## Retrieval Order

Always search from cheapest to most expensive:

1. `just find QUERY`
2. `just tag TAG`
3. `just list` (or `just list 10` / `just list 100`) if earlier commands miss
4. `just frontmatter NOTE`
5. `just body NOTE`
6. `just search PATTERN` only as the final fallback

Only `just body` counts toward local usage ranking.

## Secret Workflow

- Notes keep placeholders like `{{education.high_school.name}}`
- Register new placeholders with `just secrets-add [NOTE]`
- Fill normal values with `just secrets-set KEY` or `just secrets-fill NOTE`
- Produce the final user-facing answer first, then run `just expand`

Never write expanded secrets back into markdown files.

## Sensitive Data Rules

Do not ask for or fill highly sensitive secrets.

Examples:
- API key
- token
- password
- private key
- recovery code
- credit card number
- CVV

If a task needs those values, tell the user to enter them manually outside the AI workflow.

## External File Skills

For PDF, spreadsheet, or other document-filling skills:

- use this repository only for retrieval and final secret expansion
- let the external skill handle file parsing and writing
- stop and ask the user when required information is missing

## Writing Rules

- `body` defaults to Chinese
- `title` defaults to Chinese
- `tags` stay in English `kebab-case`
- keep committed markdown AI-safe at all times
