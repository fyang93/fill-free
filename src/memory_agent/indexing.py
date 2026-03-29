from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path

from memory_agent.registry import (
    NoteRecord,
    build_note_record,
    build_note_records,
    discover_note_paths,
    load_indexed_note_records,
    load_note_records,
    notes_index_path,
    resolve_note_record,
    state_index_path,
    tags_index_path,
    usage_index_path,
)


@dataclass(frozen=True)
class IndexSyncResult:
    mode: str
    changed: int
    deleted: int
    unchanged: int
    total: int


def rebuild_index(root: Path) -> IndexSyncResult:
    incremental_result = _sync_index_incrementally(root)
    if incremental_result is not None:
        return incremental_result

    return _rebuild_index_full(root)


def _rebuild_index_full(root: Path) -> IndexSyncResult:
    notes = build_note_records(root)
    state = _build_state_payload(_current_note_snapshot(root))
    usage = _prune_usage(load_usage_map(root), {note.path for note in notes})
    tags = _build_tag_index(notes)

    _write_jsonl(notes_index_path(root), (_note_payload(note) for note in notes))
    _write_json(tags_index_path(root), tags)
    _write_json(state_index_path(root), state)
    _write_json(usage_index_path(root), usage)
    return IndexSyncResult(
        mode="rebuilt",
        changed=len(notes),
        deleted=0,
        unchanged=0,
        total=len(notes),
    )


def ensure_index_is_current(root: Path) -> None:
    if _index_matches_notes(root):
        return
    rebuild_index(root)


def mark_note_used(root: Path, note_ref: str) -> None:
    ensure_index_is_current(root)
    note = resolve_note_record(root, note_ref)
    usage = load_usage_map(root)
    current = usage.get(note.path, {})
    usage[note.path] = {
        "use_count": _coerce_int(current.get("use_count", 0)),
        "last_used_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    usage[note.path]["use_count"] = _coerce_int(usage[note.path]["use_count"]) + 1
    valid_paths = {record.path for record in load_note_records(root)}
    _write_json(usage_index_path(root), _prune_usage(usage, valid_paths))


def load_usage_map(root: Path) -> dict[str, dict[str, object]]:
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
        usage[note_path] = {
            "use_count": _coerce_int(payload.get("use_count", 0)),
            "last_used_at": payload.get("last_used_at"),
        }
    return usage


def _build_tag_index(notes: list[NoteRecord]) -> dict[str, list[str]]:
    tags: dict[str, list[str]] = {}
    for note in notes:
        for tag in note.tags:
            tags.setdefault(tag, []).append(note.path)
    for paths in tags.values():
        paths.sort()
    return dict(sorted(tags.items()))


def _sync_index_incrementally(root: Path) -> IndexSyncResult | None:
    current_snapshot = _current_note_snapshot(root)
    indexed_snapshot = _indexed_note_snapshot(root)
    indexed_records = load_indexed_note_records(root)

    if (
        indexed_records is None
        or not tags_index_path(root).exists()
        or not indexed_snapshot
    ):
        return None

    if current_snapshot == indexed_snapshot:
        return IndexSyncResult(
            mode="synced",
            changed=0,
            deleted=0,
            unchanged=len(current_snapshot),
            total=len(current_snapshot),
        )

    changed_paths = {
        path
        for path, snapshot in current_snapshot.items()
        if indexed_snapshot.get(path) != snapshot
    }
    deleted_paths = set(indexed_snapshot) - set(current_snapshot)

    note_map = {
        note.path: NoteRecord(
            path=note.path,
            title=note.title,
            date=note.date,
            tags=note.tags,
            aliases=note.aliases,
            summary=note.summary,
        )
        for note in indexed_records
        if note.path not in changed_paths and note.path not in deleted_paths
    }

    try:
        for note_path in changed_paths:
            note_map[note_path] = build_note_record(root, root / note_path)
    except FileNotFoundError:
        return None
    except ValueError:
        return None

    notes = sorted(note_map.values(), key=lambda item: item.path)
    usage = _prune_usage(load_usage_map(root), set(note_map))
    tags = _build_tag_index(notes)

    _write_jsonl(notes_index_path(root), (_note_payload(note) for note in notes))
    _write_json(tags_index_path(root), tags)
    _write_json(state_index_path(root), _build_state_payload(current_snapshot))
    _write_json(usage_index_path(root), usage)
    return IndexSyncResult(
        mode="synced",
        changed=len(changed_paths),
        deleted=len(deleted_paths),
        unchanged=len(current_snapshot) - len(changed_paths),
        total=len(current_snapshot),
    )


def _index_matches_notes(root: Path) -> bool:
    if (
        not notes_index_path(root).exists()
        or not tags_index_path(root).exists()
        or not state_index_path(root).exists()
    ):
        return False
    return _current_note_snapshot(root) == _indexed_note_snapshot(root)


def _current_note_snapshot(root: Path) -> dict[str, tuple[int, int]]:
    snapshot: dict[str, tuple[int, int]] = {}
    for note_path in discover_note_paths(root):
        stat_result = note_path.stat()
        snapshot[note_path.relative_to(root).as_posix()] = (
            stat_result.st_mtime_ns,
            stat_result.st_size,
        )
    return snapshot


def _indexed_note_snapshot(root: Path) -> dict[str, tuple[int, int]]:
    path = state_index_path(root)
    if not path.exists():
        return {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    if not isinstance(data, dict):
        return {}

    raw_snapshot = data.get("snapshot")
    if not isinstance(raw_snapshot, dict):
        return {}

    snapshot: dict[str, tuple[int, int]] = {}
    for note_path, payload in raw_snapshot.items():
        if not isinstance(note_path, str) or not isinstance(payload, dict):
            return {}
        snapshot[note_path] = (
            _coerce_int(payload.get("mtime_ns", 0)),
            _coerce_int(payload.get("size", 0)),
        )
    return snapshot


def _note_payload(note: NoteRecord) -> dict[str, object]:
    return {
        "path": note.path,
        "title": note.title,
        "date": note.date,
        "tags": note.tags,
        "aliases": note.aliases,
        "summary": note.summary,
    }


def _build_state_payload(snapshot_map: dict[str, tuple[int, int]]) -> dict[str, object]:
    snapshot = {
        path: {"mtime_ns": mtime_ns, "size": size}
        for path, (mtime_ns, size) in snapshot_map.items()
    }
    return {
        "indexed_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "note_count": len(snapshot),
        "snapshot": snapshot,
    }


def _prune_usage(
    usage: dict[str, dict[str, object]], valid_paths: set[str]
) -> dict[str, dict[str, object]]:
    return {
        path: payload for path, payload in sorted(usage.items()) if path in valid_paths
    }


def _write_json(path: Path, payload: object) -> None:
    _ensure_index_dir(path.parent)
    tmp_path = path.with_name(f"{path.name}.tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(path)


def _write_jsonl(path: Path, rows: Iterable[dict[str, object]]) -> None:
    _ensure_index_dir(path.parent)
    tmp_path = path.with_name(f"{path.name}.tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    tmp_path.replace(path)


def _ensure_index_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _coerce_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    return 0


def format_index_sync_result(result: IndexSyncResult) -> str:
    if result.mode == "rebuilt":
        noun = "note" if result.total == 1 else "notes"
        return f"index rebuilt: {result.total} {noun}"
    return (
        "index synced: "
        f"{result.changed} changed, "
        f"{result.deleted} deleted, "
        f"{result.unchanged} unchanged"
    )
