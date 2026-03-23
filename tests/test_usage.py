from __future__ import annotations

import json

import pytest

from memory_agent.registry import load_note_records
from memory_agent.indexing import mark_note_used, rebuild_index
from memory_agent.query import (
    find_titles,
    get_body,
    get_frontmatter,
    list_titles,
    tag_titles,
)

from tests.helpers import write_note


def test_body_and_frontmatter_are_read_only(tmp_path):
    write_note(tmp_path, "memory/a.md", title="Alpha", tags=["shared"], body="A body\n")
    load_note_records(tmp_path)

    get_frontmatter(tmp_path, "Alpha")
    get_body(tmp_path, "Alpha")

    assert not (tmp_path / ".local").exists()


def test_list_find_and_tag_sort_by_title(tmp_path):
    write_note(
        tmp_path, "memory/gamma.md", title="Gamma", tags=["shared"], body="G body\n"
    )
    write_note(
        tmp_path, "memory/alpha.md", title="Alpha", tags=["shared"], body="A body\n"
    )
    write_note(
        tmp_path, "memory/beta.md", title="Beta", tags=["shared"], body="B body\n"
    )
    load_note_records(tmp_path)

    assert list_titles(tmp_path, limit=20) == ["Alpha", "Beta", "Gamma"]
    assert find_titles(tmp_path, "a") == ["Alpha", "Beta", "Gamma"]
    assert tag_titles(tmp_path, "shared") == ["Alpha", "Beta", "Gamma"]


def test_mark_note_used_updates_usage_without_changing_static_index(tmp_path):
    write_note(tmp_path, "memory/a.md", title="Alpha", tags=["shared"], body="A body\n")
    rebuild_index(tmp_path)

    mark_note_used(tmp_path, "Alpha")

    usage = json.loads((tmp_path / "index" / "usage.json").read_text(encoding="utf-8"))
    notes_index_lines = (
        (tmp_path / "index" / "notes.jsonl").read_text(encoding="utf-8").splitlines()
    )

    assert usage["memory/a.md"]["use_count"] == 1
    assert len(notes_index_lines) == 1


def test_rebuild_index_prunes_usage_for_deleted_notes(tmp_path):
    note_path = write_note(
        tmp_path,
        "memory/a.md",
        title="Alpha",
        tags=["shared"],
        body="A body\n",
    )
    rebuild_index(tmp_path)
    mark_note_used(tmp_path, "Alpha")

    note_path.unlink()
    rebuild_index(tmp_path)

    usage = json.loads((tmp_path / "index" / "usage.json").read_text(encoding="utf-8"))

    assert usage == {}


def test_mark_note_used_rejects_deleted_note_when_index_is_stale(tmp_path):
    note_path = write_note(
        tmp_path,
        "memory/a.md",
        title="Alpha",
        tags=["shared"],
        body="A body\n",
    )
    rebuild_index(tmp_path)
    note_path.unlink()

    with pytest.raises(FileNotFoundError):
        mark_note_used(tmp_path, "Alpha")
