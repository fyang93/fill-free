from __future__ import annotations

import pytest

from memory_agent.checks import CheckError, run_checks

from tests.helpers import write_note


def test_run_checks_passes_for_valid_repo(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="我的高中是杭州第二中学。\n",
    )

    run_checks(tmp_path)


def test_run_checks_rejects_invalid_tag(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["bad tag"],
        body="正文\n",
    )

    with pytest.raises(CheckError, match="bad tag"):
        run_checks(tmp_path)


def test_run_checks_passes_without_persistent_index_files(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    run_checks(tmp_path)


def test_run_checks_ignores_placeholder_like_text(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文里保留 {{temporary.template}} 也不会触发额外校验。\n",
    )

    run_checks(tmp_path)
