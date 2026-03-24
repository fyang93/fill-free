---
name: memory-agent
description: Use when working inside this repository to store or retrieve durable user memory, organize user-provided files from `workspace/` into centralized repository storage and link them from notes, produce working files into `workspace/` when requested, update record-worthy user facts, and handle requests to remember, save, record, store, sort, archive, or update information for later retrieval. This repository is also used to keep reusable personal info and supporting materials ready for later form-filling workflows. Use this whenever the user provides durable facts that should be remembered or asks AI to turn temporary local files into repo memory, but do not treat ordinary chat as memory.
---

# Memory Agent

## Overview

This repository stores AI-safe markdown in `memory/`, generated indexes in `index/`, temporary working files in `workspace/`, and organized files under `assets/`. A major use case is keeping reusable personal information and linked materials ready for later form-filling or application workflows.

Use the CLI for retrieval instead of ad-hoc scanning so lookups stay cheap and predictable. This skill decides what should become memory, which note to update, how `workspace/` files should be organized, and when indexes need rebuilding.

## Boundaries And Commands

- The CLI provides retrieval, index maintenance, usage tracking, and validation: `just list`, `just find`, `just tag`, `just frontmatter`, `just body`, `just search`, `just index`, `just use`, `just check`.
- This skill decides whether to store a fact, update an existing note, create a new note, move or copy workspace files, and add links between notes and files.
- Repeated form fields, supporting documents, and reusable application facts are strong memory candidates.
- `fd` and `rg` are support tools for index sync and raw body search, not schema validators.

## Retrieval Order

Search from cheapest to most expensive:

1. `just find QUERY`
2. `just tag TAG`
3. `just list` (or `just list 10` / `just list 100`)
4. `just frontmatter NOTE`
5. `just body NOTE`
6. `just search PATTERN` only as the final fallback

Rules:

- `just list`, `just find`, and `just tag` prefer `index/` and may sync it automatically when `index/state.json` is stale.
- A miss from `just find` or `just tag` does not prove there is no related markdown; those commands only match indexed path, title, tag, and alias data.
- If `just list` still does not surface a strong candidate, continue to `just search` before concluding that no related markdown exists.
- Read frontmatter or body only after identifying a plausible note.
- When a step identifies a note, prefer the returned title or path as `NOTE`; unique aliases also resolve, but canonical refs are less ambiguous.

## What To Capture

- Record durable user facts and explicit remember, save, record, store, or update requests.
- Treat reusable form-filling facts and supporting document organization as first-class memory.
- Do not treat ordinary conversation as memory.
- Do not store preferences, habits, moods, or speculation unless the user explicitly asks.
- Do not interrupt users for every personal detail. Only warn when the value is highly sensitive.
- If the information is clear and unambiguous, update the note without asking for confirmation.
- If the information is ambiguous, inferred, or likely to be misinterpreted, ask a short confirmation before writing.

## Sensitive Data Rules

This repository no longer has a separate local-secret workflow.

- Handle ordinary personal profile fields directly when the user asks.
- Warn only for highly sensitive operational or financial values such as passwords, API keys, private keys, recovery codes, credit card numbers, or CVV.
- In that warning, briefly say the value may enter AI context and there is no separate local-only secret storage path here.
- If the user does not insist, do not store the value.
- If the user explicitly insists, proceed carefully, do the minimum necessary handling, and avoid repeating the raw value unless required.

## Note Format

- Every note starts with `---` frontmatter.
- Keep frontmatter limited to `title`, `date`, `tags`, `aliases`, `summary`.
- Use lowercase English field names.
- Keep `date` required and formatted as `YYYY-MM-DD`.
- Keep `title`, `date`, and `summary` as single-line scalars.
- Keep `tags` and `aliases` on one line as array literals, such as `tags: ["profile", "education"]`.
- Keep `tags` in English `kebab-case`.
- Avoid multiline YAML values, nested objects, block scalars, anchors, and custom YAML features.
- Leave one blank line between frontmatter and body.

## Writing And Updating Memory

1. Search for the best existing note first.
2. Update that note when its title, aliases, tags, or topic clearly match.
3. If multiple notes might fit, prefer the one whose title or aliases most directly name the subject.
4. If no note fits, create a new topic-focused note under `memory/`.

Writing defaults:

- Prefer English note paths and filenames such as `memory/profile.md` or `memory/education.md`.
- Use Chinese for note title and body by default unless another language is clearly better for the content.
- Keep tags in English `kebab-case`.
- Keep committed markdown AI-safe.
- Preserve the frontmatter convention so indexing stays reliable.

Command timing:

- Run `just index` after creating, renaming, moving, or deleting notes in `memory/`, or after changing indexed frontmatter fields such as `title`, `tags`, or `aliases`.
- Body-only edits usually do not need a manual `just index`, though metadata commands may refresh indexes opportunistically.
- Run `just use NOTE` only when a note was actually used in a concrete downstream task, not for ordinary lookup.
- Run `just check` before claiming the repository state is valid.

## Workspace And Files

For files in `workspace/`:

- Treat `workspace/` as a temporary area for user-provided materials and AI-produced outputs.
- Do not OCR, parse, summarize, or extract facts from document contents by default.
- Unless the user explicitly asks otherwise, do not inspect the file contents; organize by filename and user instructions only.
- Use the filename plus the user's instructions as the source of truth.
- When the user asks to organize, archive, or turn those files into memory, move organized files into sensible English subpaths under `assets/` by default, such as `assets/imgs/` or `assets/docs/`, instead of being scattered next to note files.
- Copy instead of move only when the user explicitly asks to keep the original in `workspace/`.
- Prefer English path names for both note files and stored documents.
- Add markdown links from the relevant note, for example `[身份证正面照片](../assets/imgs/id-card-front.jpg)`.
- When the user wants temporary drafts or working outputs, write them back to `workspace/` unless they ask for a long-term destination.

For PDF, spreadsheet, or other document-filling skills:

- Use this repository for memory organization, centralized file linking, and retrieval.
- Let the external skill handle file parsing and file writing.
- Stop and ask only when required information is missing.

## Trigger Examples

- Store directly: "My legal name is Amy and my birthday is 1996-01-22."
- Store directly: "Help me remember this song: Qing Tian."
- Warn first: "My card CVV is ..."
- Organize from workspace: "I put my diploma in `workspace/`; help organize it into memory."
- Do not store by default: "Nice weather today."
- Ask before storing: "I might be more of a frontend engineer."
