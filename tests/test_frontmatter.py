import pytest

from memory_agent.frontmatter import (
    FrontmatterError,
    parse_markdown,
)


def test_parse_markdown_returns_frontmatter_and_body(tmp_path):
    note_path = tmp_path / "note.md"
    note_path.write_text(
        """---
title: "高中经历"
date: "2026-03-23"
tags:
  - education
  - profile
aliases:
  - 高中
summary: "记录高中教育经历"
---

我的高中是 {{education.high_school.name}}。
""",
        encoding="utf-8",
    )

    note = parse_markdown(note_path)

    assert note.metadata.title == "高中经历"
    assert note.metadata.tags == ["education", "profile"]
    assert note.metadata.aliases == ["高中"]
    assert note.metadata.summary == "记录高中教育经历"
    assert note.body == "我的高中是 {{education.high_school.name}}。\n"


def test_parse_markdown_rejects_missing_required_fields(tmp_path):
    note_path = tmp_path / "note.md"
    note_path.write_text(
        """---
title: "缺少标签"
date: "2026-03-23"
---

正文
""",
        encoding="utf-8",
    )

    with pytest.raises(FrontmatterError, match="tags"):
        parse_markdown(note_path)


def test_parse_markdown_rejects_non_list_tags(tmp_path):
    note_path = tmp_path / "note.md"
    note_path.write_text(
        """---
title: "坏标签"
date: "2026-03-23"
tags: education
---

正文
""",
        encoding="utf-8",
    )

    with pytest.raises(FrontmatterError, match="tags"):
        parse_markdown(note_path)
