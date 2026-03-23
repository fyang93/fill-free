from __future__ import annotations

from pathlib import Path
import subprocess

from notes_agent.indexing import NoteRecord, load_notes, load_tags
from notes_agent.usage import load_usage, record_usage, sort_note_paths


def list_titles(root: Path, limit: int | None = 20) -> list[str]:
    notes = load_notes(root)
    titles = _sorted_titles(notes, root)
    if limit is None:
        return titles
    return titles[:limit]


def find_titles(root: Path, query: str) -> list[str]:
    needle = query.casefold()
    matches = [note for note in load_notes(root) if _matches(note, needle)]
    return _sorted_titles(matches, root)


def tag_titles(root: Path, tag: str) -> list[str]:
    notes = load_notes(root)
    notes_by_path = {note.path: note.title for note in notes}
    matching_paths = load_tags(root).get(tag, [])
    usage = load_usage(root)
    ordered_paths = sort_note_paths(matching_paths, usage, notes_by_path)
    return [notes_by_path[path] for path in ordered_paths]


def get_frontmatter(root: Path, note_ref: str) -> str:
    note_path = resolve_note_path(root, note_ref)
    raw = note_path.read_text(encoding="utf-8")
    _, frontmatter_block, _ = raw.split("---\n", 2)
    return frontmatter_block.strip() + "\n"


def get_body(root: Path, note_ref: str) -> str:
    note_path = resolve_note_path(root, note_ref)
    raw = note_path.read_text(encoding="utf-8")
    _, _, body = raw.split("---\n", 2)
    record_usage(root, note_path.relative_to(root).as_posix())
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
    candidate = root / note_ref
    indexed_paths = {note.path for note in load_notes(root)}
    if candidate.exists() and candidate.relative_to(root).as_posix() in indexed_paths:
        return candidate

    title_matches = [note for note in load_notes(root) if note.title == note_ref]
    if len(title_matches) == 1:
        return root / title_matches[0].path
    if len(title_matches) > 1:
        raise ValueError(f"Multiple notes match title: {note_ref}")
    raise FileNotFoundError(note_ref)


def _sorted_titles(notes: list[NoteRecord], root: Path) -> list[str]:
    usage = load_usage(root)
    title_lookup = {note.path: note.title for note in notes}
    ordered_paths = sort_note_paths([note.path for note in notes], usage, title_lookup)
    return [title_lookup[path] for path in ordered_paths]
