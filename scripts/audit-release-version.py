"""Fail when active release-facing files disagree with VERSION."""

from __future__ import annotations

from pathlib import Path
import re

from release_metadata import ROOT, read_version, release_notes_path


def require_literal(path: Path, literal: str) -> None:
    text = path.read_text(encoding="utf-8")
    if literal not in text:
        raise SystemExit(f"{path.relative_to(ROOT)} is missing {literal!r}")


def require_single_match(path: Path, pattern: str, label: str) -> str:
    matches = re.findall(pattern, path.read_text(encoding="utf-8"))
    if len(matches) != 1:
        raise SystemExit(
            f"{path.relative_to(ROOT)} must contain exactly one {label}; found {len(matches)}",
        )
    value = matches[0]
    if not isinstance(value, str):
        raise SystemExit(f"{path.relative_to(ROOT)} returned an invalid {label}")
    return value


def main() -> int:
    tag = read_version()
    numeric = tag.removeprefix("v")
    major, minor, _patch = numeric.split(".")
    notes = release_notes_path(tag)

    readme = ROOT / "README.md"
    fixture = ROOT / "frontend/tests/e2e/fixtures.ts"
    route_test = ROOT / "frontend/tests/e2e/authenticated-routes.e2e.ts"

    readme_version = require_single_match(
        readme,
        r"当前源码版本为 \*\*(v[0-9]+\.[0-9]+\.[0-9]+)\*\*",
        "current source version",
    )
    if readme_version != tag:
        raise SystemExit(f"README.md current source version is {readme_version}, expected {tag}")
    require_literal(ROOT / "README.md", f"`{tag}`、`{numeric}`、`{major}.{minor}`、`{major}`")
    fixture_values = {
        "currentVersion": require_single_match(
            fixture,
            r'\bcurrentVersion:\s*"(v[0-9]+\.[0-9]+\.[0-9]+)"',
            "currentVersion fixture",
        ),
        "latestVersion": require_single_match(
            fixture,
            r'\blatestVersion:\s*"(v[0-9]+\.[0-9]+\.[0-9]+)"',
            "latestVersion fixture",
        ),
        "releaseUrl": require_single_match(
            fixture,
            r'(?m)^\s*releaseUrl:\s*"https://github\.com/JasmineTony/grok2api/releases/tag/(v[0-9]+\.[0-9]+\.[0-9]+)"',
            "release URL fixture",
        ),
        "aboutRoute": require_single_match(
            route_test,
            r'getByText\("(v[0-9]+\.[0-9]+\.[0-9]+)"\)',
            "about-route release identity",
        ),
    }
    mismatches = {name: value for name, value in fixture_values.items() if value != tag}
    if mismatches:
        raise SystemExit(f"release-facing fixture versions do not match {tag}: {mismatches}")
    require_literal(notes, f"ghcr.io/jasminetony/grok2api:{tag}")
    require_literal(notes, f"`{numeric}`")
    require_literal(notes, f"`{major}.{minor}`")
    require_literal(notes, f"`{major}`")
    require_literal(notes, "`latest`")

    release_helper = (ROOT / "scripts/github-release.py").read_text(encoding="utf-8")
    hard_coded_versions = sorted(set(re.findall(r"v[0-9]+\.[0-9]+\.[0-9]+", release_helper)))
    if hard_coded_versions:
        raise SystemExit(f"scripts/github-release.py contains hard-coded versions: {hard_coded_versions}")

    print(f"Release version audit passed: {tag}")
    print(f"Release notes: {notes.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
