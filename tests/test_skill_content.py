from __future__ import annotations

from pathlib import Path


SKILL_PATH = Path(".agents/skills/notes-agent/SKILL.md")


def test_skill_file_exists():
    assert SKILL_PATH.exists()


def test_skill_describes_command_order_and_secret_boundaries():
    content = SKILL_PATH.read_text(encoding="utf-8")

    assert "description: Use when working inside this notes repository" in content
    assert "just find" in content
    assert "just tag" in content
    assert "just list" in content
    assert "just frontmatter" in content
    assert "just body" in content
    assert "just search" in content
    assert "just expand" in content
    assert "API key" in content
    assert "CVV" in content
    assert "Do not ask for or fill" in content
