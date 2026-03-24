from __future__ import annotations

import pytest

from memory_agent.registry import load_note_records
from memory_agent.indexing import mark_note_used, rebuild_index
from memory_agent.query import (
    get_body,
    get_frontmatter,
    list_titles,
    find_titles,
    tag_titles,
)

from tests.helpers import write_note


def test_list_titles_returns_all_titles_without_dates_or_paths(tmp_path):
    write_note(tmp_path, "memory/a.md", title="Alpha", tags=["one"], body="A\n")
    write_note(tmp_path, "memory/b.md", title="Beta", tags=["two"], body="B\n")
    load_note_records(tmp_path)

    assert list_titles(tmp_path, limit=20) == ["Alpha", "Beta"]


def test_find_titles_matches_title_alias_tag_and_filename(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        aliases=["高中"],
        body="正文\n",
    )
    write_note(
        tmp_path,
        "memory/work/project-a.md",
        title="项目A同步",
        tags=["work"],
        body="正文\n",
    )
    load_note_records(tmp_path)

    assert find_titles(tmp_path, "高中") == ["高中经历"]
    assert find_titles(tmp_path, "education") == ["高中经历"]
    assert find_titles(tmp_path, "project-a") == ["项目A同步"]


def test_tag_titles_uses_runtime_tag_lookup(tmp_path):
    write_note(tmp_path, "memory/a.md", title="Alpha", tags=["shared"], body="A\n")
    write_note(tmp_path, "memory/b.md", title="Beta", tags=["shared"], body="B\n")
    load_note_records(tmp_path)

    assert tag_titles(tmp_path, "shared") == ["Alpha", "Beta"]


def test_frontmatter_and_body_return_requested_sections(tmp_path):
    note_path = write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="我的高中是 {{education.high_school.name}}。\n",
    )
    load_note_records(tmp_path)

    frontmatter = get_frontmatter(tmp_path, str(note_path.relative_to(tmp_path)))
    body = get_body(tmp_path, "高中经历")

    assert 'title: "高中经历"' in frontmatter
    assert "我的高中是" in body


def test_frontmatter_and_body_accept_unique_aliases(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        aliases=["高中"],
        body="我的高中是 {{education.high_school.name}}。\n",
    )
    load_note_records(tmp_path)

    frontmatter = get_frontmatter(tmp_path, "高中")
    body = get_body(tmp_path, "高中")

    assert 'aliases: ["高中"]' in frontmatter
    assert "我的高中是" in body


def test_frontmatter_rejects_existing_paths_outside_indexed_notes(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )
    outside_path = tmp_path / "outside.md"
    outside_path.write_text('---\ntitle: "外部"\n---\n', encoding="utf-8")
    load_note_records(tmp_path)

    with pytest.raises(FileNotFoundError):
        get_frontmatter(tmp_path, "outside.md")


def test_frontmatter_rejects_ambiguous_aliases(tmp_path):
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
    load_note_records(tmp_path)

    with pytest.raises(ValueError, match="Multiple notes match alias"):
        get_frontmatter(tmp_path, "学校")


def test_list_titles_prefers_hot_notes_from_usage_data(tmp_path):
    write_note(tmp_path, "memory/a.md", title="Alpha", tags=["shared"], body="A\n")
    write_note(tmp_path, "memory/b.md", title="Beta", tags=["shared"], body="B\n")
    rebuild_index(tmp_path)

    mark_note_used(tmp_path, "Beta")
    mark_note_used(tmp_path, "Beta")

    assert list_titles(tmp_path, limit=20) == ["Beta", "Alpha"]


def test_find_titles_refreshes_stale_index_after_frontmatter_change(tmp_path):
    note_path = write_note(
        tmp_path, "memory/a.md", title="Alpha", tags=["one"], body="A\n"
    )
    rebuild_index(tmp_path)
    note_path.write_text(
        '---\ntitle: "Beta"\ndate: "2026-03-23"\ntags: ["one"]\n---\n\nA\n',
        encoding="utf-8",
    )

    assert find_titles(tmp_path, "Beta") == ["Beta"]


def test_tag_titles_refresh_stale_index_after_note_deletion(tmp_path):
    note_path = write_note(
        tmp_path, "memory/a.md", title="Alpha", tags=["shared"], body="A\n"
    )
    rebuild_index(tmp_path)
    note_path.unlink()

    assert tag_titles(tmp_path, "shared") == []
