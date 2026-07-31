"""Resolve a single git conflict hunk by index, keeping HEAD, upstream, or both.

Usage: python scripts/resolve-conflict.py <file> <hunk-index|all> <head|upstream|both>
"""

import re
import sys

PATTERN = re.compile(r"<<<<<<< HEAD\r?\n(.*?)=======\r?\n(.*?)>>>>>>> upstream/main\r?\n", re.S)


def main() -> int:
    path, target, mode = sys.argv[1], sys.argv[2], sys.argv[3]
    source = open(path, encoding="utf-8", newline="").read()
    counter = [0]

    def replace(match: "re.Match[str]") -> str:
        counter[0] += 1
        if target != "all" and counter[0] != int(target):
            return match.group(0)
        head, upstream = match.group(1), match.group(2)
        if mode == "head":
            return head
        if mode == "upstream":
            return upstream
        return head + upstream

    resolved, total = PATTERN.subn(replace, source)
    open(path, "w", encoding="utf-8", newline="").write(resolved)
    print(f"{path}: {total} hunk(s) scanned, remaining {resolved.count('<<<<<<<')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
