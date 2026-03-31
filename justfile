set shell := ["bash", "-cu"]

opencode_host := "127.0.0.1"
opencode_port := "4096"
opencode_addr := opencode_host + ":" + opencode_port

# Show available recipes and examples.
default:
    @just --list --unsorted

# List notes from the index. Examples: `just list`, `just list --paths 10`, `just list all`.
list *args:
    uv run memory-agent list {{args}}

# Find notes by indexed metadata and summary, not body text. Examples: `just find profile`, `just find --top 3 bank account`, `just find --paths --top 1 bank account`.
find +args:
    uv run memory-agent find {{args}}

# Print compact frontmatter for one note by path or unique title. Example: `just frontmatter memory/profile.md`.
frontmatter +note:
    uv run memory-agent frontmatter --summary {{note}}

# Print one note body by path or unique title. Example: `just body 个人资料`.
body +note:
    uv run memory-agent body {{note}}

# Search note bodies. Examples: `just search --files passport`, `just search --context 2 --max-count 1 passport`, `just search passport`.
search +args:
    uv run memory-agent search {{args}}

# Rebuild indexes after note path changes or indexed-frontmatter edits.
index:
    uv run memory-agent index

# Record real downstream note usage so hot notes sort first. Example: `just use memory/profile.md`.
use +note:
    uv run memory-agent use {{note}}

# Validate notes, tags, and repository consistency.
check:
    uv run memory-agent check

# Start OpenCode serve and the Telegram bot together. Usage: `just serve`.
serve:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT INT TERM
    if ss -ltn | rg -q '{{opencode_addr}}'; then
      echo 'opencode serve already running on {{opencode_addr}}, starting bot only'
      bun run telegram:bot &
    else
      bunx opencode serve --hostname {{opencode_host}} --port {{opencode_port}} &
      echo 'waiting for opencode serve to become ready on {{opencode_addr}}...'
      for _ in $(seq 1 100); do
        if ss -ltn | rg -q '{{opencode_addr}}'; then
          break
        fi
        sleep 0.2
      done
      if ! ss -ltn | rg -q '{{opencode_addr}}'; then
        echo 'opencode serve did not start listening in time' >&2
        exit 1
      fi
      bun run telegram:bot &
    fi
    wait
