from __future__ import annotations

from pathlib import Path
import re

from memory_agent.registry import discover_note_paths
from memory_agent.frontmatter import parse_markdown


TAG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CheckError(ValueError):
    pass


def run_checks(root: Path) -> None:
    errors: list[str] = []
    for note_path in discover_note_paths(root):
        note = parse_markdown(note_path)
        for tag in note.metadata.tags:
            if not TAG_PATTERN.match(tag):
                errors.append(f"Invalid tag: {tag}")
    if errors:
        raise CheckError("; ".join(errors))
