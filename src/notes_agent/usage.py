from __future__ import annotations

import json
from pathlib import Path


def load_usage(root: Path) -> dict[str, int]:
    usage_path = root / ".local" / "usage.json"
    if not usage_path.exists():
        return {}
    return json.loads(usage_path.read_text(encoding="utf-8"))


def record_usage(root: Path, note_path: str) -> dict[str, int]:
    usage = load_usage(root)
    usage[note_path] = usage.get(note_path, 0) + 1
    usage_path = root / ".local" / "usage.json"
    usage_path.parent.mkdir(parents=True, exist_ok=True)
    usage_path.write_text(
        json.dumps(usage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return usage


def sort_note_paths(
    note_paths: list[str], usage: dict[str, int], title_lookup: dict[str, str]
) -> list[str]:
    return sorted(
        note_paths, key=lambda path: (-usage.get(path, 0), title_lookup[path])
    )
