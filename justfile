set shell := ["bash", "-cu"]

# Show available recipes and examples.
default:
    @just --list

alias i := install
alias s := serve

# Install project dependencies.
install:
    bun install

# Start the bot. Usage: `just serve`.
serve:
    bun run bot

# Run manual test suite, including live natural-language tests.
test:
    bun run test
    bun run test:nl-live

# Run only live natural-language tests against OpenCode manually.
test-live:
    bun run test:nl-live
