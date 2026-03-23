from __future__ import annotations

import argparse
import getpass
from collections.abc import Sequence
from pathlib import Path
import sys

from notes_agent.checks import CheckError, run_checks
from notes_agent.indexing import build_indexes
from notes_agent.query import (
    find_titles,
    get_body,
    get_frontmatter,
    list_titles,
    search_bodies,
    tag_titles,
)
from notes_agent.secrets import (
    SecretError,
    add_secret_keys,
    expand_text,
    fill_note_secrets,
    set_secret,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="notes-agent")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("index")

    list_parser = subparsers.add_parser("list")
    list_parser.add_argument("count", nargs="?", default="20")

    find_parser = subparsers.add_parser("find")
    find_parser.add_argument("query", nargs="+")

    tag_parser = subparsers.add_parser("tag")
    tag_parser.add_argument("tag")

    frontmatter_parser = subparsers.add_parser("frontmatter")
    frontmatter_parser.add_argument("note")

    body_parser = subparsers.add_parser("body")
    body_parser.add_argument("note")

    search_parser = subparsers.add_parser("search")
    search_parser.add_argument("pattern", nargs="+")

    secrets_add_parser = subparsers.add_parser("secrets-add")
    secrets_add_parser.add_argument("note", nargs="?")

    secrets_set_parser = subparsers.add_parser("secrets-set")
    secrets_set_parser.add_argument("key")

    secrets_fill_parser = subparsers.add_parser("secrets-fill")
    secrets_fill_parser.add_argument("note")

    subparsers.add_parser("expand")
    subparsers.add_parser("check")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0

    root = Path.cwd()

    try:
        match args.command:
            case "index":
                build_indexes(root)
                return 0
            case "list":
                limit = None if args.count == "all" else int(args.count)
                if limit is not None and limit < 0:
                    raise ValueError("list count must be non-negative")
                return _print_lines(list_titles(root, limit=limit))
            case "find":
                return _print_lines(find_titles(root, " ".join(args.query)))
            case "tag":
                return _print_lines(tag_titles(root, args.tag))
            case "frontmatter":
                sys.stdout.write(get_frontmatter(root, args.note))
                return 0
            case "body":
                sys.stdout.write(get_body(root, args.note))
                return 0
            case "search":
                sys.stdout.write(search_bodies(root, " ".join(args.pattern)))
                return 0
            case "secrets-add":
                add_secret_keys(root, args.note)
                return 0
            case "secrets-set":
                set_secret(
                    root / "secrets.toml", args.key, _read_secret_value(args.key)
                )
                return 0
            case "secrets-fill":
                fill_note_secrets(root, args.note, _build_secret_provider())
                return 0
            case "expand":
                sys.stdout.write(expand_text(root / "secrets.toml", sys.stdin.read()))
                return 0
            case "check":
                run_checks(root)
                return 0
            case _:
                parser.print_help()
                return 1
    except (CheckError, FileNotFoundError, SecretError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


def _print_lines(lines: list[str]) -> int:
    if lines:
        sys.stdout.write("\n".join(lines) + "\n")
    return 0


def _read_secret_value(key: str) -> str:
    if not sys.stdin.isatty():
        value = sys.stdin.read().rstrip("\n")
        if value:
            return value
    return getpass.getpass(f"Value for {key}: ")


def _build_secret_provider():
    values: list[str] | None = None
    if not sys.stdin.isatty():
        values = sys.stdin.read().splitlines()

    def provider(key: str) -> str:
        nonlocal values
        if values is not None:
            if not values:
                raise SecretError(f"No stdin value available for {key}")
            return values.pop(0)
        return getpass.getpass(f"Value for {key}: ")

    return provider
