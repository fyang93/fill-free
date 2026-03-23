set shell := ["bash", "-cu"]

default:
    @just --list

index:
    uv run notes-agent index

list count="20":
    uv run notes-agent list "{{count}}"

find query:
    uv run notes-agent find "{{query}}"

tag value:
    uv run notes-agent tag "{{value}}"

frontmatter note:
    uv run notes-agent frontmatter "{{note}}"

body note:
    uv run notes-agent body "{{note}}"

search pattern:
    uv run notes-agent search "{{pattern}}"

secrets-add note="":
    if [ -n "{{note}}" ]; then uv run notes-agent secrets-add "{{note}}"; else uv run notes-agent secrets-add; fi

secrets-set key:
    uv run notes-agent secrets-set "{{key}}"

secrets-fill note:
    uv run notes-agent secrets-fill "{{note}}"

expand:
    uv run notes-agent expand

check:
    uv run notes-agent check
