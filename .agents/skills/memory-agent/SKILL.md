---
name: memory-agent
description: Use when working inside this repository to store or retrieve durable user memory, organize user-provided files from `workspace/` into centralized repository storage and link them from notes, produce working files into `workspace/` when requested, update record-worthy user facts, and handle requests to remember, save, record, store, sort, archive, or update information for later retrieval. This repository is also used to keep reusable personal info and supporting materials ready for later form-filling workflows. Use this whenever the user provides durable facts that should be remembered or asks AI to turn temporary local files into repo memory, but do not treat ordinary chat as memory.
---

# Memory Agent

## Overview

This repository stores AI-safe markdown in `memory/`, generated indexes in `index/`, temporary working files in `workspace/`, and organized files under `assets/`. A major use case is keeping reusable personal information and linked materials ready so later workflows can fill forms or prepare application packets more easily.

Use the CLI instead of ad-hoc file scanning so retrieval stays cheap and predictable. This skill owns retrieval, durable user memory workflows, the decision of how to turn temporary workspace files into linked long-term memory records, and the responsibility to keep note indexes in sync after note changes.

## Capability Boundaries

- The CLI provides retrieval, index maintenance, usage tracking, and validation commands: `just list`, `just find`, `just tag`, `just frontmatter`, `just body`, `just search`, `just index`, `just use`, `just check`.
- This skill decides when user input should become memory, which existing note should be updated, and how `workspace/` files should be organized and linked.
- This skill should keep an eye on later fill-free workflows: repeated form fields, supporting documents, and reusable application facts are all good fits for durable memory.
- Note creation, note editing, file moves, and asset linking are workflow behaviors carried out by the agent; they are not first-class CLI subcommands today.
- `fd` and `rg` are support tools for index rebuilds and body search, not schema validators.

## Retrieval Order

Always search from cheapest to most expensive with indexed retrieval first:

1. `just find QUERY`
2. `just tag TAG`
3. `just list` (or `just list 10` / `just list 100`) if earlier commands miss
4. `just frontmatter NOTE`
5. `just body NOTE`
6. `just search PATTERN` only as the final fallback

`just list`, `just find`, and `just tag` should prefer `index/` when it exists. They may silently sync the index when current note paths or file timestamps no longer match `index/state.json`, using incremental updates when possible and falling back to a full rebuild when needed. `just search` remains the raw body-search fallback.

## Memory Capture Rules

- Record durable user facts and explicit remember/save requests.
- Treat reusable form-filling facts and supporting document organization as first-class memory candidates.
- When users place temporary documents in `workspace/` and ask AI to organize, archive, or turn them into memory, move the files into a centralized document path by default, add note links plus any user-supplied metadata, and only copy instead when the user explicitly asks to keep the working copy.
- Do not OCR, parse, summarize, or extract facts from document contents by default. Only process the file contents when the user explicitly asks for that.
- For file-organization requests, use the filename plus the user's instructions as the source of truth.
- Record items when the user explicitly asks you to remember, save, record, store, or update something for later retrieval.
- Do not treat ordinary conversation as memory.
- Do not treat preferences, habits, moods, or speculation as memory unless the user explicitly asks to store them.
- Do not interrupt users for every personal detail. Only warn when the value is highly sensitive, such as a password, API key, private key, recovery code, credit card number, or CVV.
- If a user provides a highly sensitive value, warn briefly that sharing it with AI is risky and that this repository no longer has a separate local secret-storage path.
- If the user still explicitly insists after that warning, proceed with the minimum necessary handling and do not repeat the raw value unless the task truly requires it.
- If the information is clear and unambiguous, update the note without asking for confirmation.
- If the information is ambiguous, inferred, or likely to be misinterpreted, ask a short confirmation before writing.

## Trigger Examples

- Store directly in markdown: "My legal name is Amy and my birthday is 1996-01-22."
- Store directly: "My government ID number is 330102..."
- Warn first, then proceed only if the user insists: "My card CVV is ..."
- Store from workspace files: "I put my diploma in `workspace/`; help organize it into memory."
- Produce into workspace: "整理一下这些资料，结果先输出到 `workspace/`。"
- Link-only storage: "These two files are my ID card front and back. Store them and link them in my profile."
- Prepare reusable application materials: "整理一下我这次签证申请要用的资料和信息。"
- Store directly: "Help me remember this song: Qing Tian."
- Do not store by default: "Nice weather today."
- Ask before storing: "I might be more of a frontend engineer."

## Frontmatter Convention

- Use a frontmatter block wrapped by `---` at the top of every note.
- In practice, keep frontmatter limited to these fields: `title`, `date`, `tags`, `aliases`, `summary`.
- Keep field names in lowercase English.
- Keep `title`, `date`, and `summary` as single-line scalar values.
- Keep `date` in `YYYY-MM-DD` when present.
- Keep `tags` and `aliases` on one line as array literals such as `tags: ["profile", "education"]`.
- Keep `tags` in English `kebab-case`.
- Avoid multiline YAML values, nested objects, block scalars, anchors, or custom YAML features.
- Keep one field per line, then leave one blank line before the body.
- This convention exists so repo-local indexing can parse notes consistently and rebuild `index/notes.jsonl`, `index/tags.json`, and `index/state.json` from markdown.
- `rg` alone cannot guarantee arbitrary YAML is query-safe; hard guarantees require stricter validation in code.

## Writing Memory

1. Search for the most relevant existing note first.
2. Update that note if its title, aliases, tags, or existing topic clearly match the memory item.
3. If multiple notes seem possible, prefer the note whose title or aliases most directly name the subject.
4. If no note is a good fit, create a new topic-focused note under `memory/`.
5. Prefer English note paths and filenames such as `memory/profile.md`, `memory/education.md`, or `memory/work.md`, while titles and body text may still be Chinese.
6. Write frontmatter that follows repository conventions and the frontmatter convention above.
7. Keep committed markdown AI-safe.
8. Use Chinese for note title and body by default unless the content itself is best kept in another language.
9. Use English `kebab-case` tags.
10. When creating, renaming, moving, or deleting notes under `memory/`, or when changing indexed frontmatter fields such as `title`, `tags`, or `aliases`, run `just index` so `index/` stays in sync.
11. When a note was actually used to complete a concrete downstream task, run `just use NOTE` so hot-note ordering stays meaningful.
12. Do not call `just use NOTE` for ordinary searches, inspections, or exploratory lookups.
13. Body-only edits usually do not require a manual `just index`, though metadata commands may still refresh the index opportunistically when timestamps move ahead of the indexed snapshot.
14. Preserve the frontmatter convention so indexing stays reliable.
15. Run `just check` before claiming the repository state is valid.

## Sensitive Data Rules

This repository no longer uses a separate local-secret workflow. By default, memory is written directly into notes or linked through files.

- Do not warn for every personal field; normal profile facts can be handled directly when the user asks.
- Warn only for highly sensitive operational or financial values, such as passwords, API keys, private keys, recovery codes, credit card numbers, or CVV.
- In that warning, briefly explain that the value may enter AI context and that the repository has no separate local-only secret storage path.
- If the user does not insist, do not store the value.
- If the user explicitly insists, proceed carefully and store only what is necessary for the requested task.
- Avoid repeating the raw value back to the user unless the task truly requires it.

## Workspace and External File Skills

For files placed in `workspace/`:

- treat `workspace/` as a temporary working area for both user-provided materials and AI-produced intermediate outputs
- unless the user explicitly asks otherwise, do not inspect the file contents; organize by filename and user instructions only
- move organized files into sensible English subpaths under `assets/`, such as `assets/imgs/`, `assets/docs/`, or other topic-based folders, so files stay centralized instead of being scattered next to note files
- copy instead of move only when the user explicitly asks to keep the original file in `workspace/`
- prefer English path names for both note files and stored documents
- add markdown links from the relevant note, for example `[身份证正面照片](../assets/imgs/id-card-front.jpg)` in `memory/profile.md`
- when the user wants temporary outputs, drafts, or sorted working files, write them under `workspace/` unless they explicitly ask for a long-term destination

For PDF, spreadsheet, or other document-filling skills:

- use this repository for memory organization, centralized file linking, and retrieval
- let the external skill handle file parsing and writing
- stop and ask the user when required information is missing

## Writing Rules

- `body` defaults to Chinese
- `title` defaults to Chinese
- `tags` stay in English `kebab-case`
- `paths` prefer English names
- keep committed markdown AI-safe at all times
