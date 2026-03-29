set shell := ["bash", "-cu"]

# Show available recipes.
default:
    @just --list

# List notes. Usage: `just list`, `just list 10`, `just list --paths 10`, `just list all`.
list *args:
    uv run memory-agent list {{args}}

# Find notes by metadata. Usage: `just find profile`, `just find --top 3 bank account`, `just find --paths --top 1 bank account`.
find +args:
    uv run memory-agent find {{args}}

# Print one note's frontmatter by path or unique title. Usage: `just frontmatter --summary memory/profile.md`, `just frontmatter memory/profile.md`.
frontmatter +args:
    uv run memory-agent frontmatter {{args}}

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
