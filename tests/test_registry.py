from __future__ import annotations

import json

import memory_agent.registry as registry_module
import pytest
from memory_agent.registry import load_note_records, load_tag_map, resolve_note_record
from memory_agent.indexing import rebuild_index

from tests.helpers import write_note


def test_load_note_records_returns_runtime_note_records_and_tags(tmp_path):
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

    notes = load_note_records(tmp_path)
    tags = load_tag_map(tmp_path)

    assert [note.title for note in notes] == ["高中经历", "项目A"]
    assert notes[0].path == "memory/profile/high-school.md"
    assert notes[0].aliases == ["高中"]
    assert notes[0].summary == "不应进入明文索引"
    assert tags == {
        "education": ["memory/profile/high-school.md"],
        "profile": ["memory/profile/high-school.md"],
        "work": ["memory/work/project-a.md"],
    }


def test_load_note_records_reflects_note_removal(tmp_path):
    note_path = write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    load_note_records(tmp_path)
    note_path.unlink()
    notes = load_note_records(tmp_path)
    tags = load_tag_map(tmp_path)

    assert notes == []
    assert tags == {}


def test_load_note_records_reads_usage_from_index(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )
    rebuild_index(tmp_path)
    usage_path = tmp_path / "index" / "usage.json"
    usage_path.write_text(
        json.dumps(
            {
                "memory/profile/high-school.md": {
                    "use_count": 3,
                    "last_used_at": "2026-03-24T12:00:00Z",
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    notes = load_note_records(tmp_path)

    assert notes[0].use_count == 3
    assert notes[0].last_used_at == "2026-03-24T12:00:00Z"


def test_rebuild_index_writes_state_and_keeps_notes_jsonl_query_focused(tmp_path):
    write_note(
        tmp_path,
        "memory/a.md",
        title="Alpha",
        tags=["shared"],
        summary="Alpha note summary",
        body="A\n",
    )

    rebuild_index(tmp_path)

    state = json.loads((tmp_path / "index" / "state.json").read_text(encoding="utf-8"))
    note_line = json.loads(
        (tmp_path / "index" / "notes.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )

    assert state["note_count"] == 1
    assert "memory/a.md" in state["snapshot"]
    assert "mtime_ns" in state["snapshot"]["memory/a.md"]
    assert "mtime_ns" not in note_line
    assert "size" not in note_line
    assert note_line["summary"] == "Alpha note summary"


def test_rebuild_index_reparses_only_changed_notes_when_state_exists(
    tmp_path, monkeypatch
):
    first_path = write_note(
        tmp_path, "memory/a.md", title="Alpha", tags=["one"], body="A\n"
    )
    second_path = write_note(
        tmp_path, "memory/b.md", title="Beta", tags=["two"], body="B\n"
    )
    rebuild_index(tmp_path)

    second_path.write_text(
        '---\ntitle: "Beta 2"\ndate: "2026-03-23"\ntags: ["two"]\n---\n\nB\n',
        encoding="utf-8",
    )

    parse_calls: list[str] = []
    original_parse = registry_module.parse_markdown

    def counting_parse(path):
        parse_calls.append(path.name)
        return original_parse(path)

    monkeypatch.setattr(registry_module, "parse_markdown", counting_parse)

    rebuild_index(tmp_path)

    assert parse_calls == [second_path.name]
    note_lines = [
        json.loads(line)
        for line in (tmp_path / "index" / "notes.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert [line["title"] for line in note_lines] == ["Alpha", "Beta 2"]
    assert first_path.relative_to(tmp_path).as_posix() == note_lines[0]["path"]


def test_resolve_note_record_accepts_unique_alias(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        aliases=["高中"],
        body="正文\n",
    )

    note = resolve_note_record(tmp_path, "高中")

    assert note.path == "memory/profile/high-school.md"


def test_resolve_note_record_rejects_ambiguous_alias(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        aliases=["学校"],
        body="正文\n",
    )
    write_note(
        tmp_path,
        "memory/profile/college.md",
        title="大学经历",
        tags=["education"],
        aliases=["学校"],
        body="正文\n",
    )

    with pytest.raises(ValueError, match="Multiple notes match alias"):
        resolve_note_record(tmp_path, "学校")
