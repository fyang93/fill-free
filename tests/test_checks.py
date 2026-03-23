from __future__ import annotations

import pytest

from notes_agent.checks import CheckError, run_checks
from notes_agent.indexing import build_indexes
from notes_agent.secrets import add_secret_keys

from tests.helpers import write_note


def test_run_checks_passes_for_valid_repo(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="{{education.high_school.name}}\n",
    )
    build_indexes(tmp_path)
    add_secret_keys(tmp_path)
    (tmp_path / "secrets.toml").write_text(
        """
[education.high_school]
name = "杭州第二中学"
""".strip()
        + "\n",
        encoding="utf-8",
    )

    run_checks(tmp_path)


def test_run_checks_rejects_invalid_tag_and_missing_secret(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["bad tag"],
        body="{{education.high_school.name}}\n",
    )
    build_indexes(tmp_path)
    add_secret_keys(tmp_path)

    with pytest.raises(CheckError, match="bad tag"):
        run_checks(tmp_path)


def test_run_checks_requires_index_files(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    with pytest.raises(CheckError, match="index"):
        run_checks(tmp_path)
