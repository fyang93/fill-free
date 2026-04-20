---
name: custom-toolbox
description: Use when the task is a small project-specific utility workflow that does not belong to memory, cli-events, cli-access, cli-rules, or cli-telegram, such as filling a 研究業務日誌 .xlsx workbook with the local helper script and returning the generated file.
---

# Custom toolbox

Use this skill for small project-specific utility tools and cookbook-like workflows that are too narrow for dedicated standalone skills.

## Boundary

Do not use this skill when the task clearly belongs to:

- `memory`
- `cli-events`
- `cli-access`
- `cli-rules`
- `cli-telegram`

Use this skill when the task is a narrow project-specific utility flow and the main work is described by a local tool note in this directory.

## Routing

- If the user uploaded a `.xlsx` file whose filename contains `研究業務日誌` and asked you to fill it or auto-complete it, read [tools/research-worklog-xlsx.md](tools/research-worklog-xlsx.md).

## General rules

- For Python helpers, use `uv run ...` rather than bare `python3`.
- Manage Python dependencies with uv rather than pip.
- Do not claim the output file was generated unless the script succeeded.
- Do not claim the file was returned to the user unless the delivery step succeeded.
- Keep the final user-visible reply short and outcome-focused.
