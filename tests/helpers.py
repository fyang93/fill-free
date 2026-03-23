from __future__ import annotations

from pathlib import Path
from shutil import copy2, copytree


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def write_note(
    base_dir: Path,
    relative_path: str,
    title: str,
    tags: list[str],
    body: str,
    aliases: list[str] | None = None,
    summary: str | None = None,
    date: str = "2026-03-23",
) -> Path:
    note_path = base_dir / relative_path
    note_path.parent.mkdir(parents=True, exist_ok=True)
    alias_line = f"aliases: {_yaml_list(aliases or [])}\n" if aliases else ""
    summary_line = f'summary: "{summary}"\n' if summary else ""
    note_path.write_text(
        "---\n"
        f'title: "{title}"\n'
        f'date: "{date}"\n'
        f"tags: {_yaml_list(tags)}\n" + alias_line + summary_line + "---\n\n" + body,
        encoding="utf-8",
    )
    return note_path


def _yaml_list(values: list[str]) -> str:
    return "[" + ", ".join(f'"{value}"' for value in values) + "]"


def copy_project_fixture(tmp_path: Path) -> None:
    for name in [
        "pyproject.toml",
        "uv.lock",
        "justfile",
        "README.md",
        ".python-version",
    ]:
        copy2(PROJECT_ROOT / name, tmp_path / name)

    copytree(
        PROJECT_ROOT / "src",
        tmp_path / "src",
        ignore=_ignore_python_cache,
    )


def _ignore_python_cache(_directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name == "__pycache__" or name.endswith(".pyc")}
