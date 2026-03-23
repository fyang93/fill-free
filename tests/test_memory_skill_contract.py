from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_PATH = ROOT / ".agents/skills/memory-agent/SKILL.md"


def test_skill_describes_memory_capture_boundaries():
    content = SKILL_PATH.read_text(encoding="utf-8")

    assert "record durable user facts" in content.lower()
    assert "remember, save, record, store, or update" in content.lower()
    assert "do not treat ordinary conversation as memory" in content.lower()
    assert "preferences, habits, moods" in content.lower()
    assert "do not interrupt users for every personal detail" in content.lower()
    assert "only warn when the value is highly sensitive" in content.lower()


def test_skill_requires_confirmation_for_ambiguous_or_inferred_memory():
    content = SKILL_PATH.read_text(encoding="utf-8")

    assert (
        "if the information is clear and unambiguous, update the note without asking for confirmation"
        in content.lower()
    )
    assert (
        "if the information is ambiguous, inferred, or likely to be misinterpreted, ask a short confirmation before writing"
        in content.lower()
    )


def test_skill_documents_retrieval_and_sensitive_warning_markers():
    content = SKILL_PATH.read_text(encoding="utf-8")

    for marker in [
        "## retrieval order",
        "just find query",
        "just tag tag",
        "just body note",
        "just search pattern",
        "## sensitive data rules",
        "warn only for highly sensitive operational or financial values",
        "value may enter ai context",
        "if the user does not insist, do not store the value",
        "if the user explicitly insists, proceed carefully",
    ]:
        assert marker in content.lower()


def test_skill_documents_link_only_file_organization_defaults():
    content = SKILL_PATH.read_text(encoding="utf-8").lower()

    for marker in [
        "do not ocr, parse, summarize, or extract facts from document contents by default",
        "use the filename plus the user's instructions as the source of truth",
        "organized files under `assets/`",
        "do not inspect the file contents; organize by filename and user instructions only",
        "move organized files into sensible english subpaths under `assets/`",
        "instead of being scattered next to note files",
        "prefer english path names for both note files and stored documents",
        "[身份证正面照片](../assets/imgs/id-card-front.jpg)",
    ]:
        assert marker in content

    assert "secrets.toml" not in content
