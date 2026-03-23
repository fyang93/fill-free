from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path
import sys

from memory_agent.checks import CheckError, run_checks
from memory_agent.indexing import (
    format_index_sync_result,
    mark_note_used,
    rebuild_index,
)
from memory_agent.query import (
    find_titles,
    get_body,
    get_frontmatter,
    list_titles,
    search_bodies,
    tag_titles,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memory-agent")
    subparsers = parser.add_subparsers(dest="command")

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

    subparsers.add_parser("index")

    use_parser = subparsers.add_parser("use")
    use_parser.add_argument("note")

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
            case "index":
                sys.stdout.write(format_index_sync_result(rebuild_index(root)) + "\n")
                return 0
            case "use":
                mark_note_used(root, args.note)
                return 0
            case "check":
                run_checks(root)
                return 0
            case _:
                parser.print_help()
                return 1
    except (CheckError, FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


def _print_lines(lines: list[str]) -> int:
    if lines:
        sys.stdout.write("\n".join(lines) + "\n")
    return 0
