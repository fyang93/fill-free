from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from re import Match
import tomllib

from notes_agent.frontmatter import SECRET_KEY_PATTERN, extract_secret_keys
from notes_agent.indexing import discover_note_paths
from notes_agent.query import resolve_note_path


MISSING_SENTINEL = "__MISSING__"


class SecretError(ValueError):
    pass


def load_secrets(secrets_path: Path) -> dict:
    if not secrets_path.exists():
        return {}
    with secrets_path.open("rb") as handle:
        return tomllib.load(handle)


def add_secret_keys(root: Path, note_ref: str | None = None) -> list[str]:
    secrets_path = root / "secrets.toml"
    secrets = load_secrets(secrets_path)
    keys = _collect_secret_keys(root, note_ref)
    added: list[str] = []
    for key in keys:
        if _get_nested_value(secrets, key) is None:
            _set_nested_value(secrets, key, MISSING_SENTINEL)
            added.append(key)
    _write_secrets(secrets_path, secrets)
    return added


def set_secret(secrets_path: Path, key: str, value: str) -> None:
    secrets = load_secrets(secrets_path)
    _set_nested_value(secrets, key, value)
    _write_secrets(secrets_path, secrets)


def fill_note_secrets(
    root: Path, note_ref: str, provider: Callable[[str], str]
) -> list[str]:
    secrets_path = root / "secrets.toml"
    secrets = load_secrets(secrets_path)
    updated: list[str] = []
    for key in _collect_secret_keys(root, note_ref):
        if _get_nested_value(secrets, key) == MISSING_SENTINEL:
            _set_nested_value(secrets, key, provider(key))
            updated.append(key)
    _write_secrets(secrets_path, secrets)
    return updated


def expand_text(secrets_path: Path, text: str) -> str:
    secrets = load_secrets(secrets_path)

    def replace(match: Match[str]) -> str:
        key = match.group(1)
        value = _get_nested_value(secrets, key)
        if value in (None, MISSING_SENTINEL):
            raise SecretError(f"Missing secret value for {key}")
        return str(value)

    return SECRET_KEY_PATTERN.sub(replace, text)


def _collect_secret_keys(root: Path, note_ref: str | None) -> list[str]:
    if note_ref is None:
        note_paths = discover_note_paths(root)
    else:
        candidate = root / note_ref
        if (
            candidate.exists()
            and candidate.is_file()
            and "memory" in candidate.relative_to(root).parts
        ):
            note_paths = [candidate]
        else:
            note_paths = [resolve_note_path(root, note_ref)]
    keys: set[str] = set()
    for note_path in note_paths:
        keys.update(extract_secret_keys(note_path.read_text(encoding="utf-8")))
    return sorted(keys)


def _get_nested_value(data: dict, dotted_key: str):
    current = data
    for part in dotted_key.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _set_nested_value(data: dict, dotted_key: str, value: str) -> None:
    current = data
    parts = dotted_key.split(".")
    for part in parts[:-1]:
        current = current.setdefault(part, {})
    current[parts[-1]] = value


def _write_secrets(secrets_path: Path, secrets: dict) -> None:
    lines = _serialize_sections(secrets)
    secrets_path.parent.mkdir(parents=True, exist_ok=True)
    secrets_path.write_text(
        "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8"
    )


def _serialize_sections(secrets: dict) -> list[str]:
    lines: list[str] = []
    sections: list[tuple[list[str], dict]] = []

    def visit(prefix: list[str], node: dict) -> None:
        scalar_items = {
            key: value for key, value in node.items() if not isinstance(value, dict)
        }
        if scalar_items:
            sections.append((prefix, scalar_items))
        for key, value in node.items():
            if isinstance(value, dict):
                visit([*prefix, key], value)

    visit([], secrets)

    for index, (prefix, scalar_items) in enumerate(sections):
        if prefix:
            lines.append(f"[{'.'.join(prefix)}]")
        for key, value in scalar_items.items():
            lines.append(f'{key} = "{_escape_string(value)}"')
        if index != len(sections) - 1:
            lines.append("")
    return lines


def _escape_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')
