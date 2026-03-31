# Agent Instructions

This repository prefers a minimal-tool workflow.

- For read-only retrieval, prefer direct `fd`/`rg` and note body search first.
- Use the `memory-agent` skill for any request that would change repository memory or long-term files: remember, save, update, organize, merge, link, move from `tmp/` to `assets/`, or reshape existing notes.
- For simple read-only questions about existing notes or assets, direct retrieval is fine; use `memory-agent` when note routing, merging, or persistence decisions are needed.
- Do not claim that notes or files were saved, moved, merged, linked, or persisted unless the repository was actually updated.
