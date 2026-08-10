"""Validated repository metadata shared by release automation."""

from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


def read_version(root: Path = ROOT) -> str:
    value = (root / "VERSION").read_text(encoding="utf-8").strip()
    if VERSION_PATTERN.fullmatch(value) is None:
        raise SystemExit(f"invalid stable VERSION: {value!r}")
    return value


def release_notes_path(tag: str, root: Path = ROOT) -> Path:
    configured = os.environ.get("GROK2API_RELEASE_NOTES", "").strip()
    candidates = [Path(configured)] if configured else list((root / "docs" / "plans").glob("*/RELEASE-NOTES.md"))
    if configured and not candidates[0].is_absolute():
        candidates[0] = root / candidates[0]

    expected_heading = f"# Grok2API {tag}"
    matches: list[Path] = []
    for candidate in candidates:
        try:
            text = candidate.read_text(encoding="utf-8").lstrip("\ufeff")
        except FileNotFoundError:
            continue
        first_content_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
        if first_content_line == expected_heading:
            matches.append(candidate.resolve())

    if len(matches) != 1:
        rendered = ", ".join(str(path) for path in matches) or "none"
        raise SystemExit(
            f"expected exactly one release-notes file headed {expected_heading!r}; found {rendered}",
        )
    return matches[0]


def release_notes(tag: str, root: Path = ROOT) -> str:
    return release_notes_path(tag, root).read_text(encoding="utf-8").lstrip("\ufeff")


def current_branch(root: Path = ROOT) -> str:
    branch = os.environ.get("GROK2API_RELEASE_BRANCH", "").strip()
    if not branch:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        )
        branch = result.stdout.strip()
    if not branch or branch == "main" or any(character.isspace() for character in branch):
        raise SystemExit(f"release PR requires a non-main branch, got {branch!r}")
    return branch
