from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import sys

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

import release_metadata

SPEC = importlib.util.spec_from_file_location("github_release", SCRIPTS / "github-release.py")
assert SPEC is not None and SPEC.loader is not None
github_release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(github_release)


class ReleaseMetadataTests(unittest.TestCase):
    def test_finds_exact_current_release_notes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "VERSION").write_text("v3.5.5\n", encoding="utf-8")
            old = root / "docs/plans/old/RELEASE-NOTES.md"
            current = root / "docs/plans/current/RELEASE-NOTES.md"
            old.parent.mkdir(parents=True)
            current.parent.mkdir(parents=True)
            old.write_text("# Grok2API v3.5.2\n", encoding="utf-8")
            current.write_text("# Grok2API v3.5.5\n", encoding="utf-8")

            tag = release_metadata.read_version(root)
            self.assertEqual(release_metadata.release_notes_path(tag, root), current.resolve())

    def test_rejects_ambiguous_release_notes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("one", "two"):
                path = root / f"docs/plans/{name}/RELEASE-NOTES.md"
                path.parent.mkdir(parents=True)
                path.write_text("# Grok2API v3.5.5\n", encoding="utf-8")

            with self.assertRaises(SystemExit):
                release_metadata.release_notes_path("v3.5.5", root)

    def test_rejects_main_as_release_pr_branch(self) -> None:
        with mock.patch.dict(os.environ, {"GROK2API_RELEASE_BRANCH": "main"}):
            with self.assertRaises(SystemExit):
                release_metadata.current_branch()


class GitHubReleaseTests(unittest.TestCase):
    def test_repository_git_url_uses_https_transport(self) -> None:
        self.assertEqual(
            github_release.repository_git_url("JasmineTony/grok2api"),
            "https://github.com/JasmineTony/grok2api.git",
        )

    def test_remote_tag_parser_requires_annotated_peel(self) -> None:
        with self.assertRaises(SystemExit):
            github_release.parse_remote_tag_refs(
                "a" * 40 + "\trefs/tags/v3.5.5\n",
                "v3.5.5",
            )

    def test_remote_tag_parser_returns_tag_object_and_commit(self) -> None:
        tag_object, commit = github_release.parse_remote_tag_refs(
            "a" * 40
            + "\trefs/tags/v3.5.5\n"
            + "b" * 40
            + "\trefs/tags/v3.5.5^{}\n",
            "v3.5.5",
        )
        self.assertEqual(tag_object, "a" * 40)
        self.assertEqual(commit, "b" * 40)

    def test_unsuccessful_merge_is_a_process_failure(self) -> None:
        with self.assertRaises(SystemExit):
            github_release.require_merged({"merged": False, "message": "required checks pending"})

    def test_successful_merge_requires_valid_sha(self) -> None:
        self.assertEqual(
            github_release.require_merged({"merged": True, "sha": "c" * 40}),
            "c" * 40,
        )
        with self.assertRaises(SystemExit):
            github_release.require_merged({"merged": True, "sha": "not-a-sha"})

    def test_release_commit_must_be_ancestor_of_remote_main(self) -> None:
        with mock.patch.object(
            github_release.subprocess,
            "run",
            return_value=github_release.subprocess.CompletedProcess([], 0, "", ""),
        ) as run:
            github_release.require_commit_ancestor("a" * 40, "b" * 40)

        run.assert_called_once_with(
            ["git", "merge-base", "--is-ancestor", "a" * 40, "b" * 40],
            cwd=github_release.ROOT,
            capture_output=True,
            text=True,
        )

    def test_release_commit_outside_remote_main_is_rejected(self) -> None:
        with mock.patch.object(
            github_release.subprocess,
            "run",
            return_value=github_release.subprocess.CompletedProcess([], 1, "", ""),
        ):
            with self.assertRaises(SystemExit):
                github_release.require_commit_ancestor("a" * 40, "b" * 40)


if __name__ == "__main__":
    unittest.main()
