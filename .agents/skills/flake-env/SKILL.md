---
name: flake-env
description: Use when a repo-level CLI, system tool, or dev-shell dependency should be available through this project's flake.nix, such as install requests, missing local tooling, or environment setup fixes.
---

# Flake Environment

Use this skill when the task is about managing this repository's development environment.

## When to Use

- The user asks to install or add a CLI/tool for this repository
- A command is missing locally and the tool should exist in the reproducible repo environment
- The task is about the dev shell, `flake.nix`, nixpkgs package selection, or repo-level tooling setup

Do not use this skill for:
- Python package installation that is better handled by `uv`
- Node/npm package installation that is better handled by `bun`
- One-off ad-hoc system installs outside the repository environment model

## Scope

- Add or remove development tools from `flake.nix`
- Resolve requests like "install X", "add tool Y", or "this command is missing" when the tool should exist in the repo environment
- Look up the correct Nix package through the NixOS MCP before editing `flake.nix`

## Permission Rule

- This skill is admin-only for any environment-changing action.
- If the requester is not `admin`, do not modify `flake.nix`, `flake.lock`, or environment-management files. State briefly that environment changes require an admin user.

## Package Selection Rules

- For Python packages and Python project tooling, prefer `uv` first when that satisfies the request.
- For npm / Node packages, prefer `bun` first when that satisfies the request.
- Use `flake.nix` for repo-level system tools, CLI programs, and other environment dependencies that should exist for this project across sessions.
- Do not install ad-hoc system packages outside `flake.nix` when the task is really about the repo environment.

## Operating Procedure

1. Use the NixOS MCP to find the correct package name in nixpkgs.
2. Update `flake.nix` minimally, preserving the existing structure.
3. Only touch `flake.lock` when inputs themselves need updating.
4. Keep `buildInputs` organized and avoid duplicate packages.
5. After editing, verify the result with a lightweight check when practical.

## Current Repository Convention

- This repository currently manages dev-shell tools via `flake.nix` under `devShell = pkgs.mkShell { buildInputs = with pkgs; [ ... ]; }`.
- Add new repo-level tools to that `buildInputs` list unless the request clearly requires a different Nix structure.

## Validation

- Do not claim a tool was installed unless the repository was actually updated and the change is consistent.
- Prefer the smallest clean edit that keeps the environment reproducible.
