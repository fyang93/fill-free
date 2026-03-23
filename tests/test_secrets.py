from __future__ import annotations

import pytest

from notes_agent.secrets import (
    SecretError,
    add_secret_keys,
    expand_text,
    fill_note_secrets,
    load_secrets,
    set_secret,
)

from tests.helpers import write_note


def test_add_secret_keys_creates_missing_entries(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="{{education.high_school.name}} {{education.high_school.start_date}}\n",
    )

    added = add_secret_keys(tmp_path)
    secrets = load_secrets(tmp_path / "secrets.toml")

    assert added == [
        "education.high_school.name",
        "education.high_school.start_date",
    ]
    assert secrets == {
        "education": {
            "high_school": {
                "name": "__MISSING__",
                "start_date": "__MISSING__",
            }
        }
    }


def test_set_secret_updates_single_key(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="{{education.high_school.name}}\n",
    )
    add_secret_keys(tmp_path)

    set_secret(tmp_path / "secrets.toml", "education.high_school.name", "杭州第二中学")

    assert (
        load_secrets(tmp_path / "secrets.toml")["education"]["high_school"]["name"]
        == "杭州第二中学"
    )


def test_add_secret_keys_does_not_overwrite_existing_values(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="{{education.high_school.name}} {{education.high_school.start_date}}\n",
    )
    add_secret_keys(tmp_path)
    set_secret(tmp_path / "secrets.toml", "education.high_school.name", "杭州第二中学")

    add_secret_keys(tmp_path)

    assert load_secrets(tmp_path / "secrets.toml") == {
        "education": {
            "high_school": {
                "name": "杭州第二中学",
                "start_date": "__MISSING__",
            }
        }
    }


def test_fill_note_secrets_only_fills_missing_values(tmp_path):
    note_path = write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="{{education.high_school.name}} {{education.high_school.end_date}}\n",
    )
    add_secret_keys(tmp_path)
    set_secret(tmp_path / "secrets.toml", "education.high_school.name", "杭州第二中学")

    fill_note_secrets(
        tmp_path,
        str(note_path.relative_to(tmp_path)),
        provider=lambda key: {"education.high_school.end_date": "2022-06"}[key],
    )

    assert load_secrets(tmp_path / "secrets.toml") == {
        "education": {
            "high_school": {
                "name": "杭州第二中学",
                "end_date": "2022-06",
            }
        }
    }


def test_expand_text_replaces_values_from_secrets_toml(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="{{education.high_school.name}}\n",
    )
    add_secret_keys(tmp_path)
    set_secret(tmp_path / "secrets.toml", "education.high_school.name", "杭州第二中学")

    rendered = expand_text(
        tmp_path / "secrets.toml", "你的高中是 {{education.high_school.name}}。"
    )

    assert rendered == "你的高中是 杭州第二中学。"


def test_expand_text_rejects_missing_or_placeholder_values(tmp_path):
    (tmp_path / "secrets.toml").write_text(
        """
[education.high_school]
name = "__MISSING__"
""".strip()
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(SecretError, match="education.high_school.name"):
        expand_text(tmp_path / "secrets.toml", "{{education.high_school.name}}")
