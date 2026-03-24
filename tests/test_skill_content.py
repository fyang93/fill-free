from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_PATH = ROOT / ".agents/skills/memory-agent/SKILL.md"
AGENTS_PATH = ROOT / "AGENTS.md"
README_PATH = ROOT / "README.md"
README_ZH_PATH = ROOT / "README.zh-CN.md"


def test_skill_file_exists():
    assert SKILL_PATH.exists()


def test_skill_uses_memory_agent_name():
    content = SKILL_PATH.read_text(encoding="utf-8")

    assert "name: memory-agent" in content


def test_skill_uses_memory_agent_runtime_names_only():
    content = SKILL_PATH.read_text(encoding="utf-8")
    content_lower = content.lower()
    legacy_cli = "notes" + "-agent"
    legacy_module = legacy_cli.replace("-", "_")

    assert "memory-agent" in content
    assert legacy_cli not in content_lower
    assert legacy_module not in content_lower


def test_repo_instructions_use_memory_agent_name():
    agents = AGENTS_PATH.read_text(encoding="utf-8")
    agents_lower = agents.lower()
    legacy_cli = "notes" + "-agent"
    legacy_module = legacy_cli.replace("-", "_")

    assert "memory-agent" in agents
    assert legacy_cli not in agents_lower
    assert legacy_module not in agents_lower


def test_active_docs_use_memory_agent_runtime_names():
    legacy_package_path = "src/" + "notes" + "_agent/"
    legacy_cli = "notes" + "-agent"
    legacy_module = legacy_cli.replace("-", "_")

    for path in (README_PATH, README_ZH_PATH):
        content = path.read_text(encoding="utf-8")
        content_lower = content.lower()

        assert "fill free" in content_lower
        assert "memory-agent" in content
        assert legacy_package_path not in content
        assert legacy_cli not in content_lower
        assert legacy_module not in content_lower


def test_active_docs_describe_centralized_document_storage_defaults():
    for path in (README_PATH, README_ZH_PATH):
        content = path.read_text(encoding="utf-8").lower()

        assert "assets/" in content
        assert "memory/profile.md" in content
        assert "just secrets" not in content
        assert "just expand" not in content

    agents = AGENTS_PATH.read_text(encoding="utf-8").lower()
    assert "workspace/" in agents


def test_active_docs_explain_list_then_search_fallback():
    readme = README_PATH.read_text(encoding="utf-8").lower()
    readme_zh = README_ZH_PATH.read_text(encoding="utf-8").lower()

    assert "does not prove there is no related note" in readme
    assert "continue to `just search` before concluding" in readme
    assert "并不能证明没有相关笔记" in readme_zh
    assert "继续用 `just search`" in readme_zh
