---
name: memory-agent
description: Use when working inside this repository to store or retrieve durable user memory, organize user-provided files from `workspace/` into centralized repository storage and link them from notes, produce working files into `workspace/` when requested, update record-worthy user facts, and handle requests to remember, save, record, store, sort, archive, or update information for later retrieval. This repository is also used to keep reusable personal info and supporting materials ready for later form-filling workflows. Use this whenever the user provides durable facts that should be remembered or asks AI to turn temporary local files into repo memory, but do not treat ordinary chat as memory.
---

# Memory Agent

## Overview

This repository stores AI-safe markdown in `memory/`, generated indexes in `index/`, temporary working files in `workspace/`, and organized files under `assets/`. A major use case is keeping reusable personal information and linked materials ready for later form-filling or application workflows.

Use the CLI for retrieval instead of ad-hoc scanning so lookups stay cheap and predictable. This skill decides what should become memory, which note to update, how `workspace/` files should be organized, and when indexes need rebuilding.

## Boundaries And Commands

- The CLI provides retrieval, index maintenance, usage tracking, and validation through a small orthogonal command set: `just list`, `just find`, `just frontmatter`, `just body`, `just search`, `just index`, `just use`, `just check`.
- Prefer flags over extra wrapper recipes: use `--paths`, `--top`, `--files`, `--max-count`, `--context`, and `--summary` on those base commands.
- `just find` accepts one or more space-separated query terms, for example `just find bank account` or `just find 银行 bank account 三井 住友`.
- Prefer `just find --top 3 --paths QUERY` for retrieval when only a few likely candidates are needed; shorter output saves token budget.
- This skill decides whether to store a fact, update an existing note, create a new note, move or copy workspace files, and add links between notes and files.
- Repeated form fields, supporting documents, and reusable application facts are strong memory candidates.
- `fd` and `rg` are support tools for index sync and raw body search, not schema validators.

## Retrieval Order

Search from cheapest to most expensive:

1. `just find --top 3 --paths QUERY`
   - Use this default when you only need the most likely few candidates and want the lowest-token output.
2. `just find --top 3 QUERY`
   - Use this when titles are easier for the current task than paths.
3. `just find QUERY`
   - Multi-term queries are broad metadata lookups over indexed path, title, tag, and alias fields. They are space-joined and matched term-by-term, so `just find 银行 bank account 三井 住友` is valid.
4. `just list --paths 10` (or `just list --paths 100`)
5. `just list` (or `just list 10` / `just list 100`)
6. `just frontmatter NOTE`
7. `just body NOTE`
8. `just search --files PATTERN`
9. `just search --context 2 --max-count 1 PATTERN`
10. `just search PATTERN` only as the final fallback

Rules:

- `just list` and `just find` prefer `index/` and may sync it automatically when `index/state.json` is stale.
- A miss from `just find` does not prove there is no related markdown; it only matches indexed path, title, tag, and alias data, plus indexed `summary` text.
- `just find` does not search note bodies. Prefer keeping a concise one-line `summary` in frontmatter so body lookups are needed less often. If likely terms may only appear inside markdown content, continue to `just search --files`, then `just search --context 2 --max-count 1`, before `just search`.
- If `just list` still does not surface a strong candidate, continue to `just search` before concluding that no related markdown exists.
- `tag` remains available in the underlying CLI for occasional maintenance or manual browsing, but it is not part of the preferred low-token just workflow.
- Read frontmatter or body only after identifying a plausible note.
- In the preferred just workflow, `just frontmatter NOTE` is the compact metadata read and returns only title, tags, aliases, and summary.
- Prefer path-only outputs for downstream agent steps because they are shorter and avoid title-resolution ambiguity.
- If `just find --top ...`, `just find --top ... --paths`, or `just find` returns one obvious hit, stop retrieval there unless the task requires specific fields.
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
- Use `summary` as a short retrieval hint for the body, so agents can decide whether to read the note without opening the body.
- Treat `body` as a higher-cost read. Reach for it only after cheaper metadata narrowing has already identified a likely note.
- Prefer snippet reads over full body reads: `just search --context 2 --max-count 1 PATTERN` is usually enough to inspect local body context without pulling an entire note into context.
- Keep `tags` and `aliases` on one line as array literals, such as `tags: ["profile", "education"]`.
- Keep `tags` in English `kebab-case`.
- Keep tags sparse: at most 3 tags per note.
- Prefer one topic-focused note per durable subject, for example `profile` for identity/profile data and `banking` for bank-account data, instead of one catch-all note.
- Prefer semantic scope over fixed length thresholds. Do not split notes just because they are long; split them when they start covering multiple stable retrieval domains.
- Avoid multiline YAML values, nested objects, block scalars, anchors, and custom YAML features.
- Leave one blank line between frontmatter and body.

## Writing And Updating Memory

1. Search for the best existing note first.
2. Update that note when its title, aliases, tags, or topic clearly match.
3. If multiple notes might fit, prefer the one whose title or aliases most directly name the subject.
4. If no note fits, create a new topic-focused note under `memory/`.
5. If the new information belongs to a different durable topic, create a sibling note instead of broadening the current note.
6. If a note's summary can no longer honestly describe the whole note as one topic, split by topic and keep links between sibling notes.

Writing defaults:

- Prefer English note paths and filenames such as `memory/profile.md`, `memory/banking.md`, or `memory/education.md`.
- Use Chinese for note title and body by default unless another language is clearly better for the content.
- Keep tags in English `kebab-case`.
- Keep committed markdown AI-safe.
- Preserve the frontmatter convention so indexing stays reliable.

Command timing:

- Run `just index` after creating, renaming, moving, or deleting notes in `memory/`, or after changing indexed frontmatter fields such as `title`, `tags`, or `aliases`.
- Body-only edits usually do not need a manual `just index`, though metadata commands may refresh indexes opportunistically.
- Run `just use NOTE` only when a note was actually used in a concrete downstream task, not for ordinary lookup.
- Run `just check` before claiming the repository state is valid.
- Treat `just check` topic-sprawl output as advisory warnings, not hard failures. Use those warnings to decide when to split notes before they become catch-all storage.

## File Protection Rules

- NEVER delete files under `assets/` or `memory/` unless the user explicitly requests deletion.
- If you determine deletion is necessary, always ask for user confirmation first.
- These folders contain organized long-term storage and user materials.

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
