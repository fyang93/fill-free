# Fill Free

[中文说明](README.zh-CN.md)

Fill Free is a local-first repository for storing reusable personal information once, then using it to help complete forms, prepare applications, and organize the supporting materials those flows need. It keeps committed notes in AI-safe Markdown and uses `workspace/` as a temporary working area for files that users want AI to organize, transform, or produce before they are represented in `memory/` or `assets/`. By default, AI does not inspect document contents; it uses filenames and user instructions to move files into centralized repository storage and add links from notes. Only when the user explicitly asks should AI process file contents. The repo-local `memory-agent` skill handles durable memory decisions such as explicit remember/save requests, form-prep organization, and file-to-memory organization.

## Principles

- `memory/` stores committed Markdown notes as the source of truth; `index/` is local generated state
- `index/` stores generated local indexes and usage counters
- organized files live under `assets/`
- stored information should be reusable across repeated form-filling workflows
- metadata retrieval prefers generated indexes; `fd` and `rg` remain available for rebuilds and body search
- warn only for highly sensitive values such as passwords, API keys, card numbers, or CVV

## Repository Layout

```text
.
├── .agents/skills/memory-agent/SKILL.md
├── index/
├── memory/
├── assets/
├── workspace/
├── justfile
├── pyproject.toml
└── src/memory_agent/
```

- `memory/`: committed AI-safe Markdown notes
- `index/`: generated JSONL/JSON indexes rebuilt from notes
- `assets/`: centralized stored documents and attachments
- `workspace/`: temporary working area for incoming files and AI-produced outputs before they are organized
- `src/memory_agent/`: Python package for the repo-local `memory-agent` CLI and skill

## Requirements

- `uv`
- Python `3.11+`
- `just`
- `fd`
- `ripgrep`

If you use Nix, the provided `flake.nix` sets up the shell.

## Setup

```bash
uv sync
```

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

I studied at Hangzhou No.2 High School.
```

The repo-local `memory-agent` skill handles durable memory retrieval and storage decisions, including explicit remember/save requests. The CLI and `just` commands provide repository retrieval, index rebuilds, and frontmatter search; they do not automatically turn ordinary chat into saved memory. Preferences, habits, and moods are not memory unless the user explicitly asks to store them.

Transformable profile fields such as names, birth dates, gender, phone numbers, school history, work history, and repeated application details may be written directly in committed markdown when the user asks to remember them.

## Capability Boundaries

- The CLI implements repository retrieval, index maintenance, usage tracking, and validation: `list`, `find`, `tag`, `frontmatter`, `body`, `search`, `index`, `use`, `check`
- The skill decides when something should become memory, how to organize `workspace/` files into notes plus `assets/` links, and how stored information should support later form-filling tasks
- The repo does not currently provide first-class CLI commands for creating notes, editing notes, moving files, or linking assets automatically
- For document-heavy tasks such as PDF or spreadsheet filling, treat this repo as the memory and file-organization layer; let other tools handle parsing and writing while Fill Free supplies the reusable personal info and supporting docs

Writing rules used by the repo-local skill:

- body defaults to Chinese
- title defaults to Chinese
- tags use English `kebab-case`
- paths prefer English names such as `memory/profile.md` and `assets/imgs/id-card-front.jpg`

## Quick Examples

- Remember a non-private fact directly: `Help me remember this song: Qing Tian.`
- Remember a transformable personal fact directly: `Please remember that my birthday is 1993-09-06.` -> note may store the date directly so AI can later format it for different contexts
- Store ordinary personal facts directly when requested: `Please remember my government ID number.`
- Warn first for highly sensitive values: `Please store my card CVV.` -> AI should warn that this is risky to share in chat and proceed only if the user explicitly insists
- Organize a workspace file without reading contents: `I put my diploma in workspace/. Please archive it into memory.` -> AI moves it to `assets/` by default, links it from a note, and only keeps a copy in `workspace/` if the user explicitly asks
- Produce working files first: `Please sort these materials and write the result into workspace/.` -> AI uses `workspace/` as the default short-term output area
- Prepare a reusable form packet: `Please organize the documents and facts I need for this visa application.` -> AI can use stored profile information plus linked files to assemble the needed materials

## Commands

```bash
just list [N|all]
just find QUERY
just tag TAG
just frontmatter NOTE
just body NOTE
just search PATTERN
just index
just use NOTE
just check
```

## Indexes and Retrieval

Metadata retrieval now prefers generated indexes under `index/`.

- `index/notes.jsonl` stores one query-focused metadata record per note
- `index/tags.json` stores the tag-to-note inverted index
- `index/state.json` stores the indexed file snapshot used for freshness checks
- `index/usage.json` stores runtime heat data such as `use_count` and `last_used_at`
- `just index` syncs indexes incrementally when possible, falls back to a full rebuild when needed, and prunes usage entries for deleted notes
- `just list`, `just find`, and `just tag` compare current note paths and file timestamps against `state.json` and silently sync the index when it looks stale
- `just use NOTE` records a real downstream use of a note so `just list` can sort by hotness
- `fd` remains useful for index rebuilds and `rg` remains useful for body search, but metadata commands no longer need to scan every note on each call
- Today, `just check` validates that notes parse and that tags are well-formed; it does not fully enforce every formatting convention described in the docs

Example `state.json` shape:

```json
{
  "indexed_at": "2026-03-24T12:34:56Z",
  "note_count": 2,
  "snapshot": {
    "memory/profile.md": {"mtime_ns": 1711283696000000000, "size": 342},
    "memory/education.md": {"mtime_ns": 1711283701000000000, "size": 518}
  }
}
```

Recommended maintenance flow after index-affecting note changes:

1. create, rename, move, or delete notes under `memory/`, or edit indexed frontmatter fields such as `title`, `tags`, or `aliases`
2. run `just index`
3. run `just check`

## Recommended Retrieval Order

Use the cheapest command first:

1. `just find QUERY`
2. `just tag TAG`
3. `just list` / `just list 10` / `just list 100`
4. `just frontmatter NOTE`
5. `just body NOTE`
6. `just search PATTERN`

`just list`, `just find`, and `just tag` read `index/` when available. `just search` remains the fallback for raw body text.

## Hot Ordering

- `just list` sorts notes by `use_count` descending, then by title
- `just use NOTE` should be called only when a note was actually used for a concrete task, not when it was merely searched or inspected
- if `usage.json` is missing or empty, `just list` falls back to title ordering
- you usually do not need to run `just index` manually for body-only edits, though metadata commands may still refresh opportunistically when file timestamps move ahead of the index

## Sensitive Data Rules

This repository no longer has a separate local-secret workflow. Memory is stored directly in notes or via linked files.

- Do not warn for every personal detail; avoid unnecessary interruptions.
- Warn only for highly sensitive values such as:

- API keys
- tokens
- passwords
- private keys
- recovery codes
- credit card numbers
- CVV

- In that warning, explain briefly that sharing the value may expose it to AI context and repository history.
- If the user does not insist, do not store it.
- If the user explicitly insists, proceed carefully and keep the handling to the minimum needed for the task.
- Avoid repeating the raw value back unless the task truly requires it.

## Workspace and External Skills

`workspace/` is a temporary working area, not long-term storage. Organized files should live under `assets/`, not be scattered next to note files, unless the user explicitly wants the output to remain in `workspace/`.

Typical flow:

- users place files like diplomas, transcripts, forms, or screenshots in `workspace/`
- AI may also write sorted results, drafts, or temporary outputs into `workspace/` when the user asks for a working-area output
- AI uses filenames and user instructions to move files into sensible English subpaths under `assets/`, such as `assets/imgs/`, `assets/docs/`, or other topic-based folders; only copy instead when the user explicitly asks to keep the original in `workspace/`
- AI adds markdown links in the relevant note, for example `[ID card front](../assets/imgs/id-card-front.jpg)` in `memory/profile.md`
- only when the user explicitly asks should AI inspect file contents or extract facts

Fill Free still does not implement complex PDF or spreadsheet filling directly. Instead:

- this repo provides memory organization, centralized file linking, retrieval, and reusable personal-info context for future forms
- external skills handle file parsing, structured extraction, and writing
- missing information should be confirmed with the user

## Verification

Run the full test suite:

```bash
uv run pytest
```
