from __future__ import annotations

from pathlib import Path
import subprocess

from memory_agent.registry import (
    NoteRecord,
    load_note_records,
    load_tag_map,
    resolve_note_record,
)
from memory_agent.indexing import ensure_index_is_current


def list_titles(root: Path, limit: int | None = 20) -> list[str]:
    ensure_index_is_current(root)
    notes = load_note_records(root)
    titles = _sorted_titles_by_usage(notes)
    if limit is None:
        return titles
    return titles[:limit]


def find_titles(root: Path, query: str) -> list[str]:
    ensure_index_is_current(root)
    needle = query.casefold()
    matches = [note for note in load_note_records(root) if _matches(note, needle)]
    return _sorted_titles(matches)


def tag_titles(root: Path, tag: str) -> list[str]:
    ensure_index_is_current(root)
    notes_by_path = {note.path: note for note in load_note_records(root)}
    matching_notes = [
        notes_by_path[path]
        for path in load_tag_map(root).get(tag, [])
        if path in notes_by_path
    ]
    return _sorted_titles(matching_notes)


def get_frontmatter(root: Path, note_ref: str) -> str:
    note_path = resolve_note_path(root, note_ref)
    raw = note_path.read_text(encoding="utf-8")
    _, frontmatter_block, _ = raw.split("---\n", 2)
    return frontmatter_block.strip() + "\n"


def get_body(root: Path, note_ref: str) -> str:
    note_path = resolve_note_path(root, note_ref)
    raw = note_path.read_text(encoding="utf-8")
    _, _, body = raw.split("---\n", 2)
    return body.lstrip("\n")


def search_bodies(root: Path, pattern: str) -> str:
    memory_dir = root / "memory"
    result = subprocess.run(
        ["rg", "--color", "never", pattern, str(memory_dir)],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout


def _matches(note: NoteRecord, needle: str) -> bool:
    haystacks = [note.path, note.title, *note.tags, *note.aliases]
    return any(needle in haystack.casefold() for haystack in haystacks)


def resolve_note_path(root: Path, note_ref: str) -> Path:
    return root / resolve_note_record(root, note_ref).path


def _sorted_titles(notes: list[NoteRecord]) -> list[str]:
    ordered_notes = sorted(notes, key=lambda note: (note.title, note.path))
    return [note.title for note in ordered_notes]


def _sorted_titles_by_usage(notes: list[NoteRecord]) -> list[str]:
    ordered_notes = sorted(
        notes,
        key=lambda note: (-note.use_count, note.title, note.path),
    )
    return [note.title for note in ordered_notes]
