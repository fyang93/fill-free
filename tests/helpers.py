from __future__ import annotations

from pathlib import Path


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
    alias_lines = ""
    if aliases:
        alias_lines = (
            "aliases:\n" + "\n".join(f"  - {alias}" for alias in aliases) + "\n"
        )
    summary_line = f'summary: "{summary}"\n' if summary else ""
    note_path.write_text(
        "---\n"
        f'title: "{title}"\n'
        f'date: "{date}"\n'
        "tags:\n"
        + "\n".join(f"  - {tag}" for tag in tags)
        + "\n"
        + alias_lines
        + summary_line
        + "---\n\n"
        + body,
        encoding="utf-8",
    )
    return note_path
