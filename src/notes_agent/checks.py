from __future__ import annotations

from pathlib import Path
import re

from notes_agent.frontmatter import extract_secret_keys, parse_markdown
from notes_agent.indexing import discover_note_paths
from notes_agent.secrets import MISSING_SENTINEL, load_secrets


TAG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CheckError(ValueError):
    pass


def run_checks(root: Path) -> None:
    notes_index = root / "index" / "notes.jsonl"
    tags_index = root / "index" / "tags.json"
    if not notes_index.exists() or not tags_index.exists():
        raise CheckError("index files are missing; run just index")

    secrets = load_secrets(root / "secrets.toml")
    errors: list[str] = []
    latest_note_mtime = 0
    for note_path in discover_note_paths(root):
        latest_note_mtime = max(latest_note_mtime, note_path.stat().st_mtime_ns)
        note = parse_markdown(note_path)
        for tag in note.metadata.tags:
            if not TAG_PATTERN.match(tag):
                errors.append(f"Invalid tag: {tag}")
        for key in extract_secret_keys(note_path.read_text(encoding="utf-8")):
            value = _get_nested_value(secrets, key)
            if value in (None, MISSING_SENTINEL):
                errors.append(f"Missing secret value for {key}")

    if (
        notes_index.stat().st_mtime_ns < latest_note_mtime
        or tags_index.stat().st_mtime_ns < latest_note_mtime
    ):
        errors.append("index files are stale; run just index")
    if errors:
        raise CheckError("; ".join(errors))


def _get_nested_value(data: dict, dotted_key: str):
    current = data
    for part in dotted_key.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current
