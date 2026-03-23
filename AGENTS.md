# Agent Instructions

This repository powers `fill-free`, which uses `memory-agent` for durable personal-info memory operations, workspace file handling, and repository retrieval.

- Proactively use `memory-agent` when the user asks to remember, save, record, store, update, archive, organize, or retrieve information for later use.
- Proactively use `memory-agent` when the user provides profile or life facts in a clear memory-capture context, even if they state the fact directly.
- Proactively use `memory-agent` when the user asks AI to process files in `workspace/`, organize them into repo memory, or produce working files there.
- Treat form-filling preparation as a first-class use case: users may want stored information and linked documents organized so AI can help complete forms or assemble the required materials later.
- Proactively use `memory-agent` when the user needs repo-local retrieval or memory-organization workflows in this repository.
- `AGENTS.md` is the repo-level trigger guide; once `memory-agent` is triggered, follow `.agents/skills/memory-agent/SKILL.md` for detailed behavior, defaults, and sensitive-data rules.
- The CLI in this repo is for retrieval, index maintenance, usage tracking, and validation; memory-writing and workspace-organization decisions live at the skill / agent-workflow layer.
- Metadata retrieval prefers generated indexes under `index/`; `fd` and `rg` are support tools for index sync and body search.
- `rg` helps with raw body search, but it does not guarantee arbitrary YAML structure.
- Do not treat ordinary chat as memory.
- Do not treat preferences, habits, or moods as memory unless the user explicitly asks to store them.
- Keep committed content in `memory/` AI-safe.
- Do not interrupt users for every personal detail. Warn only for highly sensitive values such as passwords, API keys, private keys, recovery codes, credit card numbers, or CVV, and proceed only if the user explicitly insists.
