from __future__ import annotations

import subprocess

from tests.helpers import copy_project_fixture, write_note


def test_list_command_works_via_just(tmp_path):
    copy_project_fixture(tmp_path)
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    list_result = _run(["just", "list", "10"], cwd=tmp_path)

    assert list_result.stdout.splitlines() == ["高中经历"]


def test_find_frontmatter_and_body_commands_work_via_just(tmp_path):
    copy_project_fixture(tmp_path)
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        aliases=["高中"],
        summary="记录高中教育经历",
        body="我的高中是杭州第二中学。\n",
    )
    find_result = _run(["just", "find", "高中"], cwd=tmp_path)
    frontmatter_result = _run(["just", "frontmatter", "高中经历"], cwd=tmp_path)
    frontmatter_summary_result = _run(
        ["just", "frontmatter", "--summary", "高中经历"], cwd=tmp_path
    )
    body_result = _run(["just", "body", "高中经历"], cwd=tmp_path)

    assert find_result.stdout.splitlines() == ["高中经历"]
    assert 'title: "高中经历"' in frontmatter_result.stdout
    assert 'date: "2026-03-23"' in frontmatter_result.stdout
    assert 'title: "高中经历"' in frontmatter_summary_result.stdout
    assert 'date: "2026-03-23"' not in frontmatter_summary_result.stdout
    assert 'summary: "记录高中教育经历"' in frontmatter_summary_result.stdout
    assert "我的高中是" in body_result.stdout


def test_find_command_accepts_multiple_terms_via_just(tmp_path):
    copy_project_fixture(tmp_path)
    write_note(
        tmp_path,
        "memory/profile.md",
        title="个人资料",
        tags=["profile"],
        aliases=["三井住友"],
        summary="银行账户 account 信息",
        body="正文\n",
    )

    find_result = _run(["just", "find", "银行", "bank", "account", "三井", "住友"], cwd=tmp_path)

    assert find_result.stdout.splitlines() == ["个人资料"]


def test_find_command_supports_top_and_paths_via_just(tmp_path):
    copy_project_fixture(tmp_path)
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

    find_result = _run(["just", "find", "--top", "1", "bank", "account"], cwd=tmp_path)
    path_result = _run(["just", "find", "--paths", "--top", "1", "bank", "account"], cwd=tmp_path)

    assert find_result.stdout.splitlines() == ["Alpha"]
    assert path_result.stdout.splitlines() == ["memory/a.md"]


def test_search_and_list_commands_support_low_token_flags_via_just(tmp_path):
    copy_project_fixture(tmp_path)
    write_note(
        tmp_path,
        "memory/a.md",
        title="Alpha",
        tags=["shared"],
        body="line 1\nbank line\nline 3\n",
    )

    search_result = _run(["just", "search", "--files", "bank"], cwd=tmp_path)
    search_context_result = _run(
        ["just", "search", "--context", "1", "--max-count", "1", "bank"],
        cwd=tmp_path,
    )
    list_result = _run(["just", "list", "--paths", "10"], cwd=tmp_path)

    assert search_result.stdout.splitlines() == [str(tmp_path / "memory" / "a.md")]
    assert "bank line" in search_context_result.stdout
    assert "line 1" in search_context_result.stdout
    assert "line 3" in search_context_result.stdout
    assert list_result.stdout.splitlines() == ["memory/a.md"]


def test_check_command_works_via_just(tmp_path):
    copy_project_fixture(tmp_path)
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="我的高中是杭州第二中学。\n",
    )
    check_result = _run(["just", "check"], cwd=tmp_path)

    assert check_result.returncode == 0
    assert check_result.stdout == ""


def test_check_command_emits_soft_warnings_via_just(tmp_path):
    copy_project_fixture(tmp_path)
    write_note(
        tmp_path,
        "memory/profile.md",
        title="个人资料",
        tags=["profile"],
        body="# 基本信息\n\nA\n\n# 证件\n\nB\n\n# 银行\n\nC\n\n# 工作\n\nD\n",
    )

    check_result = _run(["just", "check"], cwd=tmp_path)

    assert check_result.returncode == 0
    assert "Possible topic sprawl" in check_result.stdout


def test_index_and_use_commands_work_via_just(tmp_path):
    copy_project_fixture(tmp_path)
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    index_result = _run(["just", "index"], cwd=tmp_path)
    use_result = _run(["just", "use", "高中经历"], cwd=tmp_path)
    list_result = _run(["just", "list", "10"], cwd=tmp_path)

    assert index_result.returncode == 0
    assert "index rebuilt: 1 note" in index_result.stdout
    assert use_result.returncode == 0
    assert list_result.stdout.splitlines() == ["高中经历"]


def test_index_command_reports_incremental_sync_counts(tmp_path):
    copy_project_fixture(tmp_path)
    note_path = write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    _run(["just", "index"], cwd=tmp_path, check=True)
    note_path.write_text(
        '---\ntitle: "高中经历更新"\ndate: "2026-03-23"\ntags: ["education"]\n---\n\n正文\n',
        encoding="utf-8",
    )

    index_result = _run(["just", "index"], cwd=tmp_path)

    assert index_result.returncode == 0
    assert "index synced: 1 changed, 0 deleted, 0 unchanged" in index_result.stdout


def test_removed_commands_are_not_available_via_just(tmp_path):
    copy_project_fixture(tmp_path)
    help_result = _run(["uv", "run", "memory-agent", "--help"], cwd=tmp_path)

    assert help_result.returncode == 0
    combined = help_result.stdout + help_result.stderr
    assert "check" in combined
    assert "secrets" not in combined
    assert "expand" not in combined


def _run(command, cwd, input_text=None, check=False):
    result = subprocess.run(
        command,
        cwd=cwd,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and result.returncode != 0:
        raise AssertionError(result.stderr)
    return result
