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
    find_paths,
    find_titles,
    get_body,
    get_frontmatter,
    get_frontmatter_summary,
    list_paths,
    list_titles,
    search_bodies,
    tag_paths,
    tag_titles,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memory-agent")
    subparsers = parser.add_subparsers(dest="command")

    list_parser = subparsers.add_parser("list")
    list_parser.add_argument("count", nargs="?", default="10")
    list_parser.add_argument("--paths", action="store_true")

    find_parser = subparsers.add_parser("find")
    find_parser.add_argument("query", nargs="+")
    find_parser.add_argument("--top", type=int, default=None)
    find_parser.add_argument("--paths", action="store_true")

    tag_parser = subparsers.add_parser("tag")
    tag_parser.add_argument("tag")
    tag_parser.add_argument("--paths", action="store_true")

    frontmatter_parser = subparsers.add_parser("frontmatter")
    frontmatter_parser.add_argument("note")
    frontmatter_parser.add_argument("--summary", action="store_true")

    body_parser = subparsers.add_parser("body")
    body_parser.add_argument("note")

    search_parser = subparsers.add_parser("search")
    search_parser.add_argument("pattern", nargs="+")
    search_parser.add_argument("--files", action="store_true")
    search_parser.add_argument("--max-count", type=int, default=None)
    search_parser.add_argument("--context", type=int, default=None)

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
                if args.paths:
                    return _print_lines(list_paths(root, limit=limit))
                return _print_lines(list_titles(root, limit=limit))
            case "find":
                if args.top is not None and args.top < 0:
                    raise ValueError("find --top must be non-negative")
                if args.paths:
                    return _print_lines(find_paths(root, " ".join(args.query), limit=args.top))
                return _print_lines(find_titles(root, " ".join(args.query), limit=args.top))
            case "tag":
                if args.paths:
                    return _print_lines(tag_paths(root, args.tag))
                return _print_lines(tag_titles(root, args.tag))
            case "frontmatter":
                if args.summary:
                    sys.stdout.write(get_frontmatter_summary(root, args.note))
                    return 0
                sys.stdout.write(get_frontmatter(root, args.note))
                return 0
            case "body":
                sys.stdout.write(get_body(root, args.note))
                return 0
            case "search":
                if args.max_count is not None and args.max_count < 0:
                    raise ValueError("search --max-count must be non-negative")
                if args.context is not None and args.context < 0:
                    raise ValueError("search --context must be non-negative")
                sys.stdout.write(
                    search_bodies(
                        root,
                        " ".join(args.pattern),
                        files_only=args.files,
                        max_count=args.max_count,
                        context=args.context,
                    )
                )
                return 0
            case "index":
                sys.stdout.write(format_index_sync_result(rebuild_index(root)) + "\n")
                return 0
            case "use":
                mark_note_used(root, args.note)
                return 0
            case "check":
                warnings = run_checks(root)
                if warnings:
                    sys.stdout.write("\n".join(warnings) + "\n")
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
