set shell := ["bash", "-cu"]

opencode_host := "127.0.0.1"
opencode_port := "4196"
opencode_addr := opencode_host + ":" + opencode_port

# Show available recipes and examples.
default:
    @just --list

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
