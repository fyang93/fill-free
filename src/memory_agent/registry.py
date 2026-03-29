from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import subprocess

from memory_agent.frontmatter import parse_markdown


INDEX_DIR_NAME = "index"
NOTES_INDEX_FILE = "notes.jsonl"
TAGS_INDEX_FILE = "tags.json"
STATE_INDEX_FILE = "state.json"
USAGE_INDEX_FILE = "usage.json"


@dataclass(frozen=True)
class NoteRecord:
    path: str
    title: str
    date: str
    tags: list[str]
    aliases: list[str]
    summary: str | None = None
    use_count: int = 0
    last_used_at: str | None = None


def index_dir(root: Path) -> Path:
    return root / INDEX_DIR_NAME


def notes_index_path(root: Path) -> Path:
    return index_dir(root) / NOTES_INDEX_FILE


def tags_index_path(root: Path) -> Path:
    return index_dir(root) / TAGS_INDEX_FILE


def state_index_path(root: Path) -> Path:
    return index_dir(root) / STATE_INDEX_FILE


def usage_index_path(root: Path) -> Path:
    return index_dir(root) / USAGE_INDEX_FILE


def discover_note_paths(root: Path) -> list[Path]:
    memory_dir = root / "memory"
    if not memory_dir.exists():
        return []

    try:
        result = subprocess.run(
            [
                "fd",
                "--no-ignore",
                "--extension",
                "md",
                ".",
                str(memory_dir),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        lines = [line for line in result.stdout.splitlines() if line]
        return sorted(Path(line) for line in lines)
    except FileNotFoundError:
        try:
            result = subprocess.run(
                [
                    "find",
                    str(memory_dir),
                    "-name",
                    "*.md",
                    "-type",
                    "f",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            lines = [line for line in result.stdout.splitlines() if line]
            return sorted(Path(line) for line in lines)
        except (FileNotFoundError, subprocess.CalledProcessError):
            return sorted(memory_dir.rglob("*.md"))
    except subprocess.CalledProcessError:
        return sorted(memory_dir.rglob("*.md"))


def build_note_records(root: Path) -> list[NoteRecord]:
    notes: list[NoteRecord] = []

    for note_path in discover_note_paths(root):
        notes.append(build_note_record(root, note_path))

    notes.sort(key=lambda item: item.path)
    return notes


def build_note_record(root: Path, note_path: Path) -> NoteRecord:
    parsed = parse_markdown(note_path)
    relative_path = note_path.relative_to(root).as_posix()
    return NoteRecord(
        path=relative_path,
        title=parsed.metadata.title,
        date=parsed.metadata.date,
        tags=parsed.metadata.tags,
        aliases=parsed.metadata.aliases,
        summary=parsed.metadata.summary,
    )


def load_note_records(root: Path) -> list[NoteRecord]:
    indexed_records = load_indexed_note_records(root)
    if indexed_records is not None:
        return indexed_records

    usage = _load_usage_map(root)
    notes: list[NoteRecord] = []

    for note in build_note_records(root):
        usage_entry = usage.get(note.path, {})
        notes.append(
            NoteRecord(
                path=note.path,
                title=note.title,
                date=note.date,
                tags=note.tags,
                aliases=note.aliases,
                summary=note.summary,
                use_count=_coerce_int(usage_entry.get("use_count", 0)),
                last_used_at=_coerce_optional_str(usage_entry.get("last_used_at")),
            )
        )
    return notes


def load_tag_map(root: Path) -> dict[str, list[str]]:
    indexed_tags = _load_indexed_tag_map(root)
    if indexed_tags is not None:
        return indexed_tags

    tags: dict[str, list[str]] = {}
    for note in load_note_records(root):
        for tag in note.tags:
            tags.setdefault(tag, []).append(note.path)
    for paths in tags.values():
        paths.sort()
    return dict(sorted(tags.items()))


def resolve_note_record(root: Path, note_ref: str) -> NoteRecord:
    notes = load_note_records(root)
    candidate = root / note_ref
    indexed_paths = {note.path for note in notes}
    if candidate.exists() and candidate.relative_to(root).as_posix() in indexed_paths:
        return next(
            note
            for note in notes
            if note.path == candidate.relative_to(root).as_posix()
        )

    title_matches = [
        note for note in notes if note.title == note_ref and (root / note.path).exists()
    ]
    if len(title_matches) == 1:
        return title_matches[0]
    if len(title_matches) > 1:
        raise ValueError(f"Multiple notes match title: {note_ref}")

    alias_matches = [
        note
        for note in notes
        if note_ref in note.aliases and (root / note.path).exists()
    ]
    if len(alias_matches) == 1:
        return alias_matches[0]
    if len(alias_matches) > 1:
        raise ValueError(f"Multiple notes match alias: {note_ref}")

    raise FileNotFoundError(note_ref)


def load_indexed_note_records(root: Path) -> list[NoteRecord] | None:
    path = notes_index_path(root)
    if not path.exists():
        return None

    usage = _load_usage_map(root)
    records: list[NoteRecord] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            data = json.loads(line)
            note_path = data["path"]
            if not isinstance(note_path, str):
                return None
            usage_entry = usage.get(note_path, {})
            records.append(
                NoteRecord(
                    path=note_path,
                    title=_coerce_required_str(data["title"]),
                    date=_coerce_required_str(data["date"]),
                    tags=_coerce_str_list(data.get("tags", [])),
                    aliases=_coerce_str_list(data.get("aliases", [])),
                    summary=_coerce_optional_str(data.get("summary")),
                    use_count=_coerce_int(usage_entry.get("use_count", 0)),
                    last_used_at=_coerce_optional_str(usage_entry.get("last_used_at")),
                )
            )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None

    records.sort(key=lambda item: item.path)
    return records


def _load_indexed_tag_map(root: Path) -> dict[str, list[str]] | None:
    path = tags_index_path(root)
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    if not isinstance(data, dict):
        return None

    tags: dict[str, list[str]] = {}
    for tag, paths in data.items():
        if not isinstance(tag, str) or not isinstance(paths, list):
            return None
        if not all(isinstance(path_item, str) for path_item in paths):
            return None
        tags[tag] = sorted(paths)
    return dict(sorted(tags.items()))


def _load_usage_map(root: Path) -> dict[str, dict[str, object]]:
    path = usage_index_path(root)
    if not path.exists():
        return {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    if not isinstance(data, dict):
        return {}

    usage: dict[str, dict[str, object]] = {}
    for note_path, payload in data.items():
        if not isinstance(note_path, str) or not isinstance(payload, dict):
            continue
        usage[note_path] = payload
    return usage


def _coerce_optional_str(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


def _coerce_required_str(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("expected string")
    return value


def _coerce_str_list(value: object) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise TypeError("expected list[str]")
    return value


def _coerce_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    return 0
