"""Create, merge, or release the current v3.5.2 settings iteration.

GitHub credentials are read with ``git credential fill`` and remain in memory.
The release command expects the annotated VERSION tag to already exist remotely.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

REPO = "JasmineTony/grok2api"
BRANCH = "release/v3.5.2-runtime-settings-ui"
ROOT = Path(__file__).resolve().parents[1]
NOTES = ROOT / "docs/plans/2026-08-07-28-runtime-settings-ui-v3.5.2/RELEASE-NOTES.md"
VERSION_FILE = ROOT / "VERSION"


def version() -> str:
    value = VERSION_FILE.read_text(encoding="utf-8").strip()
    parts = value.removeprefix("v").split(".")
    if not value.startswith("v") or len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise SystemExit(f"invalid VERSION: {value!r}")
    return value


def token() -> str:
    result = subprocess.run(
        ["git", "credential", "fill"],
        cwd=ROOT,
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True,
        text=True,
        check=True,
    )
    for line in result.stdout.splitlines():
        if line.startswith("password="):
            return line.removeprefix("password=")
    raise SystemExit("no GitHub credential available")


def api(method: str, path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
    request = urllib.request.Request(
        f"https://api.github.com{path}",
        method=method,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token()}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "grok2api-release-script",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"{method} {path} failed: {error.code}\n{detail}") from error


def notes() -> str:
    return NOTES.read_text(encoding="utf-8").lstrip("\ufeff")


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("usage: github-release.py pr|merge <number>|release")
    command = sys.argv[1]
    tag = version()
    if command == "pr":
        result = api(
            "POST",
            f"/repos/{REPO}/pulls",
            {
                "title": f"feat(settings): align runtime layout and release {tag}",
                "head": BRANCH,
                "base": "main",
                "body": notes(),
            },
        )
        print(f"PR #{result['number']}: {result['html_url']}")
    elif command == "merge":
        if len(sys.argv) != 3:
            raise SystemExit("usage: github-release.py merge <number>")
        number = sys.argv[2]
        result = api(
            "PUT",
            f"/repos/{REPO}/pulls/{number}/merge",
            {"merge_method": "merge"},
        )
        print(f"merged={result.get('merged')} sha={result.get('sha')}")
    elif command == "release":
        result = api(
            "POST",
            f"/repos/{REPO}/releases",
            {
                "tag_name": tag,
                "name": f"Grok2API {tag}",
                "body": notes(),
                "draft": False,
                "prerelease": False,
                "make_latest": "true",
            },
        )
        print(f"release: {result['html_url']}")
    else:
        raise SystemExit(f"unknown command {command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
