"""Create the release pull request and GitHub release for the current iteration.

Credentials come from `git credential fill`, so the token is never passed on a command
line or written to disk. Usage:

    python scripts/github-release.py pr
    python scripts/github-release.py merge <number>
    python scripts/github-release.py release
"""

import json
import subprocess
import sys
import urllib.error
import urllib.request

REPO = "JasmineTony/grok2api"
BRANCH = "sync/upstream-v3.0.11-20260729"
NOTES = "docs/plans/2026-07-29-23-upstream-v3.0.11-sync-v3.4.0/RELEASE-NOTES.md"
FOOTER = "\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n"


def token() -> str:
    result = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True,
        text=True,
        check=True,
    )
    for line in result.stdout.splitlines():
        if line.startswith("password="):
            return line[len("password=") :]
    raise SystemExit("no GitHub credential available")


def api(method: str, path: str, payload: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"https://api.github.com{path}",
        method=method,
        data=None if payload is None else json.dumps(payload).encode(),
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
        detail = error.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} failed: {error.code}\n{detail}") from error


def notes() -> str:
    with open(NOTES, encoding="utf-8") as handle:
        return handle.read().lstrip("﻿")


def main() -> int:
    command = sys.argv[1]
    if command == "pr":
        result = api(
            "POST",
            f"/repos/{REPO}/pulls",
            {
                "title": "sync: upstream v3.0.11, defect fixes, settings split (v3.4.0)",
                "head": BRANCH,
                "base": "main",
                "body": notes() + FOOTER,
            },
        )
        print(f"PR #{result['number']}: {result['html_url']}")
    elif command == "merge":
        number = sys.argv[2]
        result = api(
            "PUT",
            f"/repos/{REPO}/pulls/{number}/merge",
            {"merge_method": "merge", "commit_title": f"Merge pull request #{number} from {BRANCH}"},
        )
        print(f"merged={result.get('merged')} sha={result.get('sha')}")
    elif command == "release":
        result = api(
            "POST",
            f"/repos/{REPO}/releases",
            {
                "tag_name": "v3.4.0",
                "target_commitish": "main",
                "name": "v3.4.0",
                "body": notes(),
                "draft": False,
                "prerelease": False,
            },
        )
        print(f"release: {result['html_url']}")
    else:
        raise SystemExit(f"unknown command {command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
