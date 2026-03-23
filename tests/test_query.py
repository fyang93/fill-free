from __future__ import annotations

import pytest

from notes_agent.indexing import build_indexes
from notes_agent.query import (
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
    build_indexes(tmp_path)

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
    build_indexes(tmp_path)

    assert find_titles(tmp_path, "高中") == ["高中经历"]
    assert find_titles(tmp_path, "education") == ["高中经历"]
    assert find_titles(tmp_path, "project-a") == ["项目A同步"]


def test_tag_titles_uses_inverted_index(tmp_path):
    write_note(tmp_path, "memory/a.md", title="Alpha", tags=["shared"], body="A\n")
    write_note(tmp_path, "memory/b.md", title="Beta", tags=["shared"], body="B\n")
    build_indexes(tmp_path)

    assert tag_titles(tmp_path, "shared") == ["Alpha", "Beta"]


def test_frontmatter_and_body_return_requested_sections(tmp_path):
    note_path = write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="我的高中是 {{education.high_school.name}}。\n",
    )
    build_indexes(tmp_path)

    frontmatter = get_frontmatter(tmp_path, str(note_path.relative_to(tmp_path)))
    body = get_body(tmp_path, "高中经历")

    assert 'title: "高中经历"' in frontmatter
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
    build_indexes(tmp_path)

    with pytest.raises(FileNotFoundError):
        get_frontmatter(tmp_path, "outside.md")
