---
name: flake-env
description: Use when a repo-level CLI, system tool, or dev-shell dependency should be available through this project's flake.nix, such as install requests, missing local tooling, or environment setup fixes.
---

# Flake Environment

Use this skill when the task is about this repository's reproducible development environment.

## When to use

- The user asks to install or add a repo-level CLI or system tool.
- A command is missing locally and it should exist in the repo environment.
- The task is about `flake.nix`, the dev shell, package selection, or repo-level tooling setup.

Do not use this skill for:

- Python package installation better handled by `uv`
- Node package installation better handled by `bun`
- One-off system installs outside the repository environment model

## Principles

- Keep environment decisions in repo configuration, not in prompt-time workarounds.
- Use `flake.nix` for repo-level tools that should be reproducible across sessions.
- Prefer the smallest clean edit.
- Keep the environment understandable and avoid duplicate packages.

## Access rule

- Environment-changing actions are admin-only.
- If the requester is not `admin`, do not modify environment-management files. State briefly that environment changes require an admin user.

## Procedure

1. Find the correct nixpkgs package, using the NixOS MCP when available.
2. Update `flake.nix` minimally and preserve the existing shape.
3. Touch `flake.lock` only when inputs actually need updating.
4. Verify with a lightweight check when practical.

## Repository convention

- This repository currently exposes dev-shell tools through `flake.nix` using `pkgs.mkShell` and `buildInputs`.
- Add new repo-level tools there unless the request clearly needs a different Nix structure.

## Validation

- Do not claim a tool was installed unless the repository was actually updated and the result is consistent.
