"""Create, merge, or publish the release described by repository metadata.

GitHub credentials are read with ``git credential fill`` and remain in memory.
The release command fails closed unless the remote VERSION tag is annotated,
peels to the local tag commit, and matches the remote ``main`` head.
"""

from __future__ import annotations

from functools import lru_cache
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

from release_metadata import ROOT, current_branch, read_version, release_notes

DEFAULT_REPO = "JasmineTony/grok2api"
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def repository() -> str:
    value = os.environ.get("GROK2API_REPOSITORY", DEFAULT_REPO).strip()
    if value.count("/") != 1 or any(character.isspace() for character in value):
        raise SystemExit(f"invalid GitHub repository: {value!r}")
    return value


def git_output(*arguments: str, root: Path = ROOT) -> str:
    result = subprocess.run(
        ["git", *arguments],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


@lru_cache(maxsize=1)
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


def parse_remote_tag_refs(output: str, tag: str) -> tuple[str, str]:
    refs: dict[str, str] = {}
    for line in output.splitlines():
        parts = line.split()
        if len(parts) == 2:
            refs[parts[1]] = parts[0]
    tag_ref = f"refs/tags/{tag}"
    peeled_ref = f"{tag_ref}^{{}}"
    tag_object = refs.get(tag_ref, "")
    peeled_commit = refs.get(peeled_ref, "")
    if SHA_PATTERN.fullmatch(tag_object) is None or SHA_PATTERN.fullmatch(peeled_commit) is None:
        raise SystemExit(f"remote tag {tag} must be annotated and expose both tag and peeled refs")
    if tag_object == peeled_commit:
        raise SystemExit(f"remote tag {tag} does not have a distinct annotated tag object")
    return tag_object, peeled_commit


def validate_remote_release_tag(tag: str) -> tuple[str, str]:
    local_type = git_output("cat-file", "-t", f"refs/tags/{tag}")
    if local_type != "tag":
        raise SystemExit(f"local tag {tag} must be annotated, got object type {local_type!r}")
    local_commit = git_output("rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}")
    remote_output = git_output(
        "ls-remote",
        "--tags",
        "origin",
        f"refs/tags/{tag}",
        f"refs/tags/{tag}^{{}}",
    )
    tag_object, remote_commit = parse_remote_tag_refs(remote_output, tag)
    if remote_commit != local_commit:
        raise SystemExit(
            f"remote tag {tag} peels to {remote_commit}, but the local annotated tag peels to {local_commit}",
        )
    remote_main_lines = git_output("ls-remote", "origin", "refs/heads/main").splitlines()
    if len(remote_main_lines) != 1:
        raise SystemExit("unable to resolve exactly one remote main ref")
    remote_main = remote_main_lines[0].split()[0]
    if SHA_PATTERN.fullmatch(remote_main) is None or remote_main != remote_commit:
        raise SystemExit(
            f"remote tag {tag} peels to {remote_commit}, but origin/main is {remote_main}",
        )
    return tag_object, remote_commit


def require_merged(result: dict[str, object]) -> str:
    if result.get("merged") is not True:
        message = result.get("message", "GitHub did not merge the pull request")
        raise SystemExit(f"pull request merge failed: {message}")
    sha = result.get("sha")
    if not isinstance(sha, str) or SHA_PATTERN.fullmatch(sha) is None:
        raise SystemExit(f"pull request merged without a valid merge SHA: {sha!r}")
    return sha


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("usage: github-release.py pr|merge <number>|check-tag|release")
    command = sys.argv[1]
    tag = read_version()
    repo = repository()
    if command == "pr":
        branch = current_branch()
        body = release_notes(tag)
        result = api(
            "POST",
            f"/repos/{repo}/pulls",
            {
                "title": f"release: publish {tag}",
                "head": branch,
                "base": "main",
                "body": body,
            },
        )
        print(f"PR #{result['number']}: {result['html_url']}")
    elif command == "merge":
        if len(sys.argv) != 3:
            raise SystemExit("usage: github-release.py merge <number>")
        result = api(
            "PUT",
            f"/repos/{repo}/pulls/{sys.argv[2]}/merge",
            {"merge_method": "merge"},
        )
        print(f"merged=True sha={require_merged(result)}")
    elif command == "check-tag":
        tag_object, peeled_commit = validate_remote_release_tag(tag)
        print(f"annotated_tag={tag_object} peeled_commit={peeled_commit}")
    elif command == "release":
        tag_object, peeled_commit = validate_remote_release_tag(tag)
        body = release_notes(tag)
        result = api(
            "POST",
            f"/repos/{repo}/releases",
            {
                "tag_name": tag,
                "name": f"Grok2API {tag}",
                "body": body,
                "draft": False,
                "prerelease": False,
                "make_latest": "true",
            },
        )
        print(f"release: {result['html_url']}")
        print(f"annotated_tag={tag_object} peeled_commit={peeled_commit}")
    else:
        raise SystemExit(f"unknown command {command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
