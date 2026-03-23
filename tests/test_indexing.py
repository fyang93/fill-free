from __future__ import annotations

import json

from notes_agent.indexing import build_indexes

from tests.helpers import write_note


def test_build_indexes_creates_notes_and_tag_indexes(tmp_path):
    memory_dir = tmp_path / "memory"
    index_dir = tmp_path / "index"
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education", "profile"],
        aliases=["高中"],
        summary="不应进入明文索引",
        body="我的高中是 {{education.high_school.name}}。\n",
    )
    write_note(
        tmp_path,
        "memory/work/project-a.md",
        title="项目A",
        tags=["work"],
        body="项目A 正文\n",
    )

    build_indexes(tmp_path)

    notes_lines = (index_dir / "notes.jsonl").read_text(encoding="utf-8").splitlines()
    notes = [json.loads(line) for line in notes_lines]
    tags = json.loads((index_dir / "tags.json").read_text(encoding="utf-8"))

    assert [note["title"] for note in notes] == ["高中经历", "项目A"]
    assert notes[0]["path"] == "memory/profile/high-school.md"
    assert notes[0]["aliases"] == ["高中"]
    assert "summary" not in notes[0]
    assert tags == {
        "education": ["memory/profile/high-school.md"],
        "profile": ["memory/profile/high-school.md"],
        "work": ["memory/work/project-a.md"],
    }


def test_build_indexes_rewrites_outputs_after_note_removal(tmp_path):
    note_path = write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    build_indexes(tmp_path)
    note_path.unlink()
    build_indexes(tmp_path)

    notes_lines = (
        (tmp_path / "index" / "notes.jsonl").read_text(encoding="utf-8").splitlines()
    )
    tags = json.loads((tmp_path / "index" / "tags.json").read_text(encoding="utf-8"))

    assert notes_lines == []
    assert tags == {}
