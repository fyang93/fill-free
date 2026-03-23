set shell := ["bash", "-cu"]

# Show available recipes.
default:
    @just --list

# List note titles by hotness, then title. Usage: `just list`, `just list 10`, `just list all`.
list count="20":
    uv run memory-agent list "{{count}}"

# Find notes by title, alias, tag, or path fragment. Usage: `just find profile`.
find query:
    uv run memory-agent find "{{query}}"

# List notes with a tag. Usage: `just tag profile`.
tag value:
    uv run memory-agent tag "{{value}}"

# Print one note's frontmatter by path or unique title. Usage: `just frontmatter memory/profile.md`.
frontmatter note:
    uv run memory-agent frontmatter "{{note}}"

# Print one note's body by path or unique title. Usage: `just body 个人资料`.
body note:
    uv run memory-agent body "{{note}}"

# Run raw body search with ripgrep. Usage: `just search 身份证`.
search pattern:
    uv run memory-agent search "{{pattern}}"

# Rebuild note indexes after path or indexed-frontmatter changes. Usage: `just index`.
index:
    uv run memory-agent index

# Record a real note use so hot notes sort first. Usage: `just use memory/profile.md`.
use note:
    uv run memory-agent use "{{note}}"

# Validate notes and tags. Usage: `just check`.
check:
    uv run memory-agent check
