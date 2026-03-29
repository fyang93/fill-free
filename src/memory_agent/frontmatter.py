from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


class FrontmatterError(ValueError):
    pass


@dataclass(frozen=True)
class NoteMetadata:
    title: str
    date: str
    tags: list[str]
    aliases: list[str]
    summary: str | None


@dataclass(frozen=True)
class ParsedMarkdown:
    metadata: NoteMetadata
    body: str


def parse_markdown(note_path: Path) -> ParsedMarkdown:
    raw = note_path.read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        raise FrontmatterError(f"{note_path} is missing frontmatter")

    try:
        _, frontmatter_block, body = raw.split("---\n", 2)
    except ValueError as exc:
        raise FrontmatterError(f"{note_path} has invalid frontmatter") from exc

    data = yaml.safe_load(frontmatter_block) or {}
    title = data.get("title")
    date = data.get("date")
    tags = data.get("tags")

    if not title:
        raise FrontmatterError("title is required")
    if not date:
        raise FrontmatterError("date is required")
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        raise FrontmatterError("tags must be a list of strings")

    aliases = data.get("aliases", [])
    if not isinstance(aliases, list) or not all(
        isinstance(alias, str) for alias in aliases
    ):
        raise FrontmatterError("aliases must be a list of strings")

    summary = data.get("summary")
    if summary is not None and not isinstance(summary, str):
        raise FrontmatterError("summary must be a string")

    return ParsedMarkdown(
        metadata=NoteMetadata(
            title=title,
            date=str(date),
            tags=tags,
            aliases=aliases,
            summary=summary,
        ),
        body=body.lstrip("\n"),
    )


def render_metadata_summary(metadata: NoteMetadata) -> str:
    lines = [
        f'title: "{metadata.title}"',
        f"tags: {_yaml_list(metadata.tags)}",
    ]
    if metadata.aliases:
        lines.append(f"aliases: {_yaml_list(metadata.aliases)}")
    if metadata.summary is not None:
        lines.append(f'summary: "{metadata.summary}"')
    return "\n".join(lines) + "\n"


def _yaml_list(values: list[str]) -> str:
    return "[" + ", ".join(f'\"{value}\"' for value in values) + "]"
