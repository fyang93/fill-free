from __future__ import annotations

import json

from notes_agent.indexing import build_indexes
from notes_agent.query import (
    find_titles,
    get_body,
    get_frontmatter,
    list_titles,
    tag_titles,
)

from tests.helpers import write_note


def test_body_access_increments_usage_but_frontmatter_does_not(tmp_path):
    write_note(tmp_path, "memory/a.md", title="Alpha", tags=["shared"], body="A body\n")
    build_indexes(tmp_path)

    get_frontmatter(tmp_path, "Alpha")
    assert _read_usage(tmp_path) == {}

    get_body(tmp_path, "Alpha")

    assert _read_usage(tmp_path) == {"memory/a.md": 1}


def test_list_find_and_tag_sort_by_usage_then_title(tmp_path):
    write_note(
        tmp_path, "memory/alpha.md", title="Alpha", tags=["shared"], body="A body\n"
    )
    write_note(
        tmp_path, "memory/beta.md", title="Beta", tags=["shared"], body="B body\n"
    )
    write_note(
        tmp_path, "memory/gamma.md", title="Gamma", tags=["shared"], body="G body\n"
    )
    build_indexes(tmp_path)

    get_body(tmp_path, "Beta")
    get_body(tmp_path, "Beta")
    get_body(tmp_path, "Gamma")

    assert list_titles(tmp_path, limit=20) == ["Beta", "Gamma", "Alpha"]
    assert find_titles(tmp_path, "a") == ["Beta", "Gamma", "Alpha"]
    assert tag_titles(tmp_path, "shared") == ["Beta", "Gamma", "Alpha"]


def _read_usage(root):
    usage_path = root / ".local" / "usage.json"
    if not usage_path.exists():
        return {}
    return json.loads(usage_path.read_text(encoding="utf-8"))
