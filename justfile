set shell := ["bash", "-cu"]

# Show available recipes and examples.
default:
    @just --list

alias i := install
alias s := serve

# Install project dependencies.
install:
    bun install

# Start a fresh OpenCode server, then run the bot. Usage: `just serve`.
serve:
    mkdir -p logs; \
    self=$$; \
    pids=$(pgrep -f '/bin/.opencode serve --port 4096|node .*/opencode serve --port 4096|opencode serve --port 4096' | grep -vx "$self" || true); \
    for pid in $pids; do \
        kill "$pid" 2>/dev/null || true; \
    done; \
    opencode serve --port 4096 > logs/opencode-server.log 2>&1 & \
    opencode_pid=$!; \
    trap 'kill "$opencode_pid" 2>/dev/null || true' EXIT; \
    sleep 2; \
    bun run bot

# Run manual test suite, including live natural-language tests.
test:
    bun run test
    bun run test:nl-live

# Run only live natural-language tests against OpenCode manually.
test-live:
    bun run test:nl-live
