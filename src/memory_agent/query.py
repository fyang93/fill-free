from __future__ import annotations

from pathlib import Path
import subprocess

from memory_agent.frontmatter import parse_markdown, render_metadata_summary
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


def list_paths(root: Path, limit: int | None = 20) -> list[str]:
    ensure_index_is_current(root)
    notes = load_note_records(root)
    paths = _sorted_paths_by_usage(notes)
    if limit is None:
        return paths
    return paths[:limit]


def find_titles(root: Path, query: str, limit: int | None = None) -> list[str]:
    ensure_index_is_current(root)
    scored_matches = [
        (note, _match_score(note, query)) for note in load_note_records(root)
    ]
    matches = [item for item in scored_matches if item[1] > 0]
    titles = _sorted_titles_by_score(matches)
    if limit is None:
        return titles
    return titles[:limit]


def find_paths(root: Path, query: str, limit: int | None = None) -> list[str]:
    ensure_index_is_current(root)
    scored_matches = [
        (note, _match_score(note, query)) for note in load_note_records(root)
    ]
    matches = [item for item in scored_matches if item[1] > 0]
    paths = _sorted_paths_by_score(matches)
    if limit is None:
        return paths
    return paths[:limit]


def tag_titles(root: Path, tag: str) -> list[str]:
    ensure_index_is_current(root)
    notes_by_path = {note.path: note for note in load_note_records(root)}
    matching_notes = [
        notes_by_path[path]
        for path in load_tag_map(root).get(tag, [])
        if path in notes_by_path
    ]
    return _sorted_titles(matching_notes)


def tag_paths(root: Path, tag: str) -> list[str]:
    ensure_index_is_current(root)
    notes_by_path = {note.path: note for note in load_note_records(root)}
    matching_notes = [
        notes_by_path[path]
        for path in load_tag_map(root).get(tag, [])
        if path in notes_by_path
    ]
    return _sorted_paths(matching_notes)


def get_frontmatter(root: Path, note_ref: str) -> str:
    note_path = resolve_note_path(root, note_ref)
    raw = note_path.read_text(encoding="utf-8")
    _, frontmatter_block, _ = raw.split("---\n", 2)
    return frontmatter_block.strip() + "\n"


def get_frontmatter_summary(root: Path, note_ref: str) -> str:
    note_path = resolve_note_path(root, note_ref)
    parsed = parse_markdown(note_path)
    return render_metadata_summary(parsed.metadata)


def get_body(root: Path, note_ref: str) -> str:
    note_path = resolve_note_path(root, note_ref)
    raw = note_path.read_text(encoding="utf-8")
    _, _, body = raw.split("---\n", 2)
    return body.lstrip("\n")


def search_bodies(
    root: Path,
    pattern: str,
    *,
    files_only: bool = False,
    max_count: int | None = None,
    context: int | None = None,
) -> str:
    memory_dir = root / "memory"
    command = ["rg", "--color", "never"]
    if files_only:
        command.append("--files-with-matches")
    else:
        command.append("--line-number")
    if max_count is not None:
        command.extend(["--max-count", str(max_count)])
    if context is not None:
        command.extend(["--context", str(context)])
    command.extend([pattern, str(memory_dir)])
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout


def _query_terms(query: str) -> list[str]:
    return [term.casefold() for term in query.split() if term.strip()]


def _match_score(note: NoteRecord, query: str) -> int:
    haystacks = [
        note.path,
        note.title,
        *note.tags,
        *note.aliases,
        *([note.summary] if note.summary else []),
    ]
    lowered_haystacks = [haystack.casefold() for haystack in haystacks]
    whole_query = query.casefold().strip()
    terms = _query_terms(query)

    score = 0
    if whole_query and any(whole_query in haystack for haystack in lowered_haystacks):
        score += max(2, len(terms) or 1)

    score += sum(
        1 for term in terms if any(term in haystack for haystack in lowered_haystacks)
    )
    return score


def resolve_note_path(root: Path, note_ref: str) -> Path:
    return root / resolve_note_record(root, note_ref).path


def _sorted_titles(notes: list[NoteRecord]) -> list[str]:
    ordered_notes = sorted(notes, key=lambda note: (note.title, note.path))
    return [note.title for note in ordered_notes]


def _sorted_paths(notes: list[NoteRecord]) -> list[str]:
    ordered_notes = sorted(notes, key=lambda note: (note.title, note.path))
    return [note.path for note in ordered_notes]


def _sorted_titles_by_score(scored_notes: list[tuple[NoteRecord, int]]) -> list[str]:
    ordered_notes = sorted(
        scored_notes,
        key=lambda item: (-item[1], item[0].title, item[0].path),
    )
    return [note.title for note, _ in ordered_notes]


def _sorted_paths_by_score(scored_notes: list[tuple[NoteRecord, int]]) -> list[str]:
    ordered_notes = sorted(
        scored_notes,
        key=lambda item: (-item[1], item[0].title, item[0].path),
    )
    return [note.path for note, _ in ordered_notes]


def _sorted_titles_by_usage(notes: list[NoteRecord]) -> list[str]:
    ordered_notes = sorted(
        notes,
        key=lambda note: (-note.use_count, note.title, note.path),
    )
    return [note.title for note in ordered_notes]


def _sorted_paths_by_usage(notes: list[NoteRecord]) -> list[str]:
    ordered_notes = sorted(
        notes,
        key=lambda note: (-note.use_count, note.title, note.path),
    )
    return [note.path for note in ordered_notes]
