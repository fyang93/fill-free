from __future__ import annotations

import subprocess

from tests.helpers import copy_project_fixture


def test_public_cli_rename_contract(tmp_path):
    copy_project_fixture(tmp_path)

    legacy_package = "notes" + "_agent"
    legacy_cli = legacy_package.replace("_", "-")
    pyproject = (tmp_path / "pyproject.toml").read_text(encoding="utf-8")
    justfile = (tmp_path / "justfile").read_text(encoding="utf-8")
    help_result = _run(["uv", "run", "memory-agent", "--help"], cwd=tmp_path)
    old_help_result = _run(["uv", "run", legacy_cli, "--help"], cwd=tmp_path)

    assert 'name = "memory-agent"' in pyproject
    assert 'memory-agent = "memory_agent:main"' in pyproject
    assert legacy_cli not in pyproject
    assert "uv run memory-agent" in justfile
    assert legacy_cli not in justfile
    assert help_result.returncode == 0
    help_output = help_result.stdout + help_result.stderr
    assert "memory-agent" in help_output
    assert legacy_cli not in help_output
    assert old_help_result.returncode != 0


def _run(command, cwd):
    return subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )
