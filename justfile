set shell := ["bash", "-cu"]

opencode_host := "127.0.0.1"
opencode_port := "4096"
opencode_addr := opencode_host + ":" + opencode_port

# Show available recipes.
default:
    @just --list

# List notes. Usage: `just list`, `just list 10`, `just list --paths 10`, `just list all`.
list *args:
    uv run memory-agent list {{args}}

# Find notes by metadata. Usage: `just find profile`, `just find --top 3 bank account`, `just find --paths --top 1 bank account`.
find +args:
    uv run memory-agent find {{args}}

# Print compact note metadata by path or unique title. Usage: `just frontmatter memory/profile.md`.
frontmatter +note:
    uv run memory-agent frontmatter --summary {{note}}

# Print one note's body by path or unique title. Usage: `just body 个人资料`.
body +note:
    uv run memory-agent body {{note}}

# Search note bodies. Usage: `just search --files passport`, `just search --context 2 --max-count 1 passport`, `just search passport`.
search +args:
    uv run memory-agent search {{args}}

# Rebuild note indexes after path or indexed-frontmatter changes. Usage: `just index`.
index:
    uv run memory-agent index

# Record a real note use so hot notes sort first. Usage: `just use memory/profile.md`.
use +note:
    uv run memory-agent use {{note}}

# Validate notes and tags. Usage: `just check`.
check:
    uv run memory-agent check

# Start OpenCode serve and the Telegram bot together. Usage: `just serve-bot`.
serve-bot:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT INT TERM
    if ss -ltn | rg -q '{{opencode_addr}}'; then
      echo 'opencode serve already running on {{opencode_addr}}, starting bot only'
      bun run telegram:bot &
    else
      bunx opencode serve --hostname {{opencode_host}} --port {{opencode_port}} &
      bun run telegram:bot &
    fi
    wait
