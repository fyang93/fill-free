from __future__ import annotations

import pytest

from memory_agent.registry import load_note_records
from memory_agent.indexing import mark_note_used, rebuild_index
from memory_agent.query import (
    find_paths,
    find_titles,
    get_body,
    get_frontmatter,
    get_frontmatter_summary,
    list_paths,
    list_titles,
    search_bodies,
)

from tests.helpers import write_note


def test_list_titles_returns_all_titles_without_dates_or_paths(tmp_path):
    write_note(tmp_path, "memory/a.md", title="Alpha", tags=["one"], body="A\n")
    write_note(tmp_path, "memory/b.md", title="Beta", tags=["two"], body="B\n")
    load_note_records(tmp_path)

    assert list_titles(tmp_path, limit=20) == ["Alpha", "Beta"]
    assert list_paths(tmp_path, limit=20) == ["memory/a.md", "memory/b.md"]


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


def test_find_titles_matches_summary_without_body_search(tmp_path):
    write_note(
        tmp_path,
        "memory/bank.md",
        title="银行资料",
        tags=["finance"],
        summary="三井住友银行账户和转账信息",
        body="正文里没有这些检索词。\n",
    )
    load_note_records(tmp_path)

    assert find_titles(tmp_path, "三井住友 银行 账户") == ["银行资料"]


def test_find_titles_accepts_multi_term_or_queries_and_ranks_better_matches_first(tmp_path):
    write_note(
        tmp_path,
        "memory/profile.md",
        title="个人资料",
        tags=["profile"],
        aliases=["三井住友"],
        summary="银行账户 account 信息",
        body="正文\n",
    )
    write_note(
        tmp_path,
        "memory/work.md",
        title="工作资料",
        tags=["work"],
        aliases=["account"],
        body="正文\n",
    )
    load_note_records(tmp_path)

    assert find_titles(tmp_path, "银行 bank account 三井 住友") == ["个人资料", "工作资料"]


def test_find_titles_supports_top_limit(tmp_path):
    write_note(
        tmp_path,
        "memory/a.md",
        title="Alpha",
        tags=["one"],
        summary="bank account transfer",
        body="A\n",
    )
    write_note(
        tmp_path,
        "memory/b.md",
        title="Beta",
        tags=["two"],
        summary="bank",
        body="B\n",
    )
    load_note_records(tmp_path)

    assert find_titles(tmp_path, "bank account", limit=1) == ["Alpha"]
    assert find_paths(tmp_path, "bank account", limit=1) == ["memory/a.md"]


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
    frontmatter_summary = get_frontmatter_summary(
        tmp_path, str(note_path.relative_to(tmp_path))
    )
    body = get_body(tmp_path, "高中经历")

    assert 'title: "高中经历"' in frontmatter
    assert 'date: "2026-03-23"' in frontmatter
    assert 'title: "高中经历"' in frontmatter_summary
    assert 'date: "2026-03-23"' not in frontmatter_summary
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


def test_search_bodies_supports_files_only_max_count_and_context(tmp_path):
    write_note(
        tmp_path,
        "memory/a.md",
        title="Alpha",
        tags=["one"],
        body="line 1\nbank line 2\nline 3\n",
    )

    assert search_bodies(tmp_path, "bank", files_only=True).strip() == str(
        tmp_path / "memory" / "a.md"
    )
    assert search_bodies(tmp_path, "bank", max_count=1).count("bank") == 1
    context_output = search_bodies(tmp_path, "bank", context=1)
    assert "bank line 2" in context_output
    assert "line 1" in context_output
    assert "line 3" in context_output
