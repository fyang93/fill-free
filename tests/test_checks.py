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

    assert run_checks(tmp_path) == []


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


def test_run_checks_rejects_too_many_tags(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education", "profile", "china", "history"],
        body="正文\n",
    )

    with pytest.raises(CheckError, match="Too many tags"):
        run_checks(tmp_path)


def test_run_checks_passes_without_persistent_index_files(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    assert run_checks(tmp_path) == []


def test_run_checks_ignores_placeholder_like_text(tmp_path):
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文里保留 {{temporary.template}} 也不会触发额外校验。\n",
    )

    assert run_checks(tmp_path) == []


def test_run_checks_emits_soft_warning_for_possible_topic_sprawl(tmp_path):
    write_note(
        tmp_path,
        "memory/profile.md",
        title="个人资料",
        tags=["profile"],
        body="# 基本信息\n\nA\n\n# 证件\n\nB\n\n# 银行\n\nC\n\n# 工作\n\nD\n",
    )

    warnings = run_checks(tmp_path)

    assert len(warnings) == 1
    assert "Possible topic sprawl" in warnings[0]


def test_run_checks_rejects_multiline_summary(tmp_path):
    note_path = write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        summary="单行摘要",
        body="正文\n",
    )
    note_path.write_text(
        note_path.read_text(encoding="utf-8").replace(
            'summary: "单行摘要"',
            'summary: "第一行\\n第二行"',
        ),
        encoding="utf-8",
    )

    with pytest.raises(CheckError, match="Summary must be single-line"):
        run_checks(tmp_path)
