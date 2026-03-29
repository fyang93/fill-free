from __future__ import annotations

from pathlib import Path
import re

from memory_agent.registry import discover_note_paths
from memory_agent.frontmatter import parse_markdown


TAG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_TAGS_PER_NOTE = 3
HEADING_PATTERN = re.compile(r"^#\s+", re.MULTILINE)
RELATED_NOTE_LINK_PATTERN = re.compile(r"\]\((?:\.\./)?memory/[^)]+\.md\)")


class CheckError(ValueError):
    pass


def run_checks(root: Path) -> list[str]:
    errors: list[str] = []
    warnings: list[str] = []
    for note_path in discover_note_paths(root):
        note = parse_markdown(note_path)
        relative_path = note_path.relative_to(root)
        if len(note.metadata.tags) > MAX_TAGS_PER_NOTE:
            errors.append(
                f"Too many tags ({len(note.metadata.tags)} > {MAX_TAGS_PER_NOTE}): {relative_path}"
            )
        for tag in note.metadata.tags:
            if not TAG_PATTERN.match(tag):
                errors.append(f"Invalid tag: {tag}")
        if note.metadata.summary is not None and "\n" in note.metadata.summary:
            errors.append(f"Summary must be single-line: {relative_path}")

        warnings.extend(_collect_topic_sprawl_warnings(relative_path, note.body))
    if errors:
        raise CheckError("; ".join(errors))
    return warnings


def _collect_topic_sprawl_warnings(relative_path: Path, body: str) -> list[str]:
    top_level_heading_count = len(HEADING_PATTERN.findall(body))
    related_note_link_count = len(RELATED_NOTE_LINK_PATTERN.findall(body))
    warnings: list[str] = []

    if top_level_heading_count >= 4 and related_note_link_count == 0:
        warnings.append(
            "Possible topic sprawl: "
            f"{relative_path} has {top_level_heading_count} top-level sections but no links to sibling notes"
        )
    return warnings
