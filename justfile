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
