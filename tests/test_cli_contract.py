from __future__ import annotations

import subprocess

from tests.helpers import write_note


def test_index_and_list_commands_work_via_just(tmp_path):
    _copy_project_files(tmp_path)
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="正文\n",
    )

    index_result = _run(["just", "index"], cwd=tmp_path)
    list_result = _run(["just", "list", "10"], cwd=tmp_path)

    assert index_result.returncode == 0
    assert list_result.stdout.splitlines() == ["高中经历"]


def test_find_tag_frontmatter_and_body_commands_work_via_just(tmp_path):
    _copy_project_files(tmp_path)
    write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        aliases=["高中"],
        body="我的高中是 {{education.high_school.name}}。\n",
    )
    _run(["just", "index"], cwd=tmp_path, check=True)

    find_result = _run(["just", "find", "高中"], cwd=tmp_path)
    tag_result = _run(["just", "tag", "education"], cwd=tmp_path)
    frontmatter_result = _run(["just", "frontmatter", "高中经历"], cwd=tmp_path)
    body_result = _run(["just", "body", "高中经历"], cwd=tmp_path)

    assert find_result.stdout.splitlines() == ["高中经历"]
    assert tag_result.stdout.splitlines() == ["高中经历"]
    assert 'title: "高中经历"' in frontmatter_result.stdout
    assert "我的高中是" in body_result.stdout


def test_secrets_workflow_and_check_command_work_via_just(tmp_path):
    _copy_project_files(tmp_path)
    note_path = write_note(
        tmp_path,
        "memory/profile/high-school.md",
        title="高中经历",
        tags=["education"],
        body="我的高中是 {{education.high_school.name}}。\n",
    )
    _run(["just", "index"], cwd=tmp_path, check=True)

    add_result = _run(
        ["just", "secrets-add", str(note_path.relative_to(tmp_path))], cwd=tmp_path
    )
    set_result = _run(
        ["just", "secrets-set", "education.high_school.name"],
        cwd=tmp_path,
        input_text="杭州第二中学\n",
    )
    expand_result = _run(
        ["just", "expand"],
        cwd=tmp_path,
        input_text="你的高中是 {{education.high_school.name}}。",
    )
    check_result = _run(["just", "check"], cwd=tmp_path)

    assert add_result.returncode == 0
    assert set_result.returncode == 0
    assert expand_result.stdout == "你的高中是 杭州第二中学。"
    assert check_result.returncode == 0


def _copy_project_files(tmp_path):
    for name in [
        "pyproject.toml",
        "uv.lock",
        "justfile",
        "README.md",
        ".python-version",
    ]:
        source = PROJECT_ROOT / name
        target = tmp_path / name
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")

    _copy_tree(PROJECT_ROOT / "src", tmp_path / "src")


def _copy_tree(source, target):
    target.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        if child.name == "__pycache__" or child.suffix == ".pyc":
            continue
        destination = target / child.name
        if child.is_dir():
            _copy_tree(child, destination)
        else:
            destination.write_text(child.read_text(encoding="utf-8"), encoding="utf-8")


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


PROJECT_ROOT = __import__("pathlib").Path(__file__).resolve().parents[1]
