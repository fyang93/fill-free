from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import subprocess

from notes_agent.frontmatter import parse_markdown


@dataclass(frozen=True)
class NoteRecord:
    path: str
    title: str
    date: str
    tags: list[str]
    aliases: list[str]
    mtime: str


def discover_note_paths(root: Path) -> list[Path]:
    memory_dir = root / "memory"
    if not memory_dir.exists():
        return []

    result = subprocess.run(
        ["fd", "--extension", "md", ".", str(memory_dir)],
        check=True,
        capture_output=True,
        text=True,
    )
    lines = [line for line in result.stdout.splitlines() if line]
    return sorted(Path(line) for line in lines)


def build_indexes(root: Path) -> list[NoteRecord]:
    index_dir = root / "index"
    index_dir.mkdir(parents=True, exist_ok=True)

    notes: list[NoteRecord] = []
    tags_index: dict[str, list[str]] = {}

    for note_path in discover_note_paths(root):
        parsed = parse_markdown(note_path)
        relative_path = note_path.relative_to(root).as_posix()
        record = NoteRecord(
            path=relative_path,
            title=parsed.metadata.title,
            date=parsed.metadata.date,
            tags=parsed.metadata.tags,
            aliases=parsed.metadata.aliases,
            mtime=_iso_mtime(note_path),
        )
        notes.append(record)
        for tag in parsed.metadata.tags:
            tags_index.setdefault(tag, []).append(relative_path)

    notes.sort(key=lambda item: item.path)
    for paths in tags_index.values():
        paths.sort()

    (index_dir / "notes.jsonl").write_text(
        "".join(
            json.dumps(record.__dict__, ensure_ascii=False) + "\n" for record in notes
        ),
        encoding="utf-8",
    )
    (index_dir / "tags.json").write_text(
        json.dumps(dict(sorted(tags_index.items())), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return notes


def load_notes(root: Path) -> list[NoteRecord]:
    notes_path = root / "index" / "notes.jsonl"
    if not notes_path.exists():
        return []

    records: list[NoteRecord] = []
    for line in notes_path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        payload = json.loads(line)
        records.append(NoteRecord(**payload))
    return records


def load_tags(root: Path) -> dict[str, list[str]]:
    tags_path = root / "index" / "tags.json"
    if not tags_path.exists():
        return {}
    return json.loads(tags_path.read_text(encoding="utf-8"))


def _iso_mtime(note_path: Path) -> str:
    return note_path.stat().st_mtime_ns.__str__()
