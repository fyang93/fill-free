set shell := ["bash", "-cu"]

opencode_host := "127.0.0.1"
opencode_port := "4096"
opencode_addr := opencode_host + ":" + opencode_port

# Show available recipes and examples.
default:
    @just --list

alias i := install
alias s := serve
alias d := dev

# Install project dependencies.
install:
    bun install

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

# Start OpenCode serve and the Telegram bot in development watch mode. Usage: `just dev`.
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT INT TERM
    if ss -ltn | rg -q '{{opencode_addr}}'; then
      echo 'opencode serve already running on {{opencode_addr}}, starting bot in watch mode'
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
    fi
    snapshot() {
      find src/telegram_bot -type f -name '*.ts' -print0 \
        | sort -z \
        | xargs -0 stat -c '%n %Y %s' 2>/dev/null || true
    }
    last_snapshot="$(snapshot)"
    echo 'starting bot dev runner'
    bun run telegram:bot &
    bot_pid=$!
    echo "bot started pid=${bot_pid}"
    while true; do
      sleep 1
      next_snapshot="$(snapshot)"
      if [ "$next_snapshot" = "$last_snapshot" ]; then
        continue
      fi
      last_snapshot="$next_snapshot"
      echo 'source change detected, restarting bot...'
      kill "$bot_pid" 2>/dev/null || true
      wait "$bot_pid" 2>/dev/null || true
      bun run telegram:bot &
      bot_pid=$!
      echo "bot restarted pid=${bot_pid}"
    done
