#!/usr/bin/env python3
"""Assemble the morning routine's Routine prompt.

A claude.ai Routine starts a fresh cloud session that has none of this plugin's
files, so setup stores everything the run needs in the Routine's prompt:
run.md, brief-format.md, and the review prompt from pr-review.sh, with the
per-user values filled in.
"""

import argparse
import re
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent
DEFAULT_PR_REVIEW_SH = SKILL_DIR / "../../../pr-review/skills/pr-review/pr-review.sh"

PLACEHOLDERS = {"GITHUB_LOGIN", "TIMEZONE", "ARTIFACT_URL", "BRIEF_FORMAT", "REVIEW_PROMPT"}
PLACEHOLDER_RE = re.compile(r"\{\{([A-Z_]+)\}\}")
ARTIFACT_URL_RE = re.compile(r"^https://claude\.ai/(code/)?artifact/[A-Za-z0-9_-]+$")
GITHUB_LOGIN_RE = re.compile(r"^[A-Za-z0-9-]{1,39}$")


def extract_review_prompt(script_text: str) -> str:
    """Return the review prompt heredoc from pr-review.sh, without its markers."""
    lines = script_text.splitlines()
    start = next((i for i, line in enumerate(lines) if "<<'PROMPT_EOF'" in line), None)
    end = None
    if start is not None:
        end = next((i for i in range(start + 1, len(lines)) if lines[i] == "PROMPT_EOF"), None)
    if start is None or end is None:
        raise ValueError("review prompt markers not found in pr-review.sh")
    return "\n".join(lines[start + 1 : end])


def assemble(
    template: str,
    *,
    review_prompt: str,
    brief_format: str,
    github_login: str,
    timezone: str,
    artifact_url: str,
) -> str:
    """Fill run.md's placeholders. The review prompt goes in last, unscanned."""
    if not ARTIFACT_URL_RE.match(artifact_url):
        raise ValueError(f"not a claude.ai artifact URL: {artifact_url!r}")
    if not GITHUB_LOGIN_RE.match(github_login):
        raise ValueError(f"not a GitHub login: {github_login!r}")

    found = set(PLACEHOLDER_RE.findall(template))
    if unknown := found - PLACEHOLDERS:
        raise ValueError(f"unknown placeholders in run.md: {', '.join(sorted(unknown))}")
    if missing := PLACEHOLDERS - found:
        raise ValueError(f"placeholders missing from run.md: {', '.join(sorted(missing))}")

    values = {
        "GITHUB_LOGIN": github_login,
        "TIMEZONE": timezone,
        "ARTIFACT_URL": artifact_url,
        "BRIEF_FORMAT": brief_format,
    }
    filled = PLACEHOLDER_RE.sub(lambda m: values.get(m[1], m[0]), template)
    return filled.replace("{{REVIEW_PROMPT}}", review_prompt)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--github-login", required=True)
    parser.add_argument("--artifact-url", required=True)
    parser.add_argument("--timezone", default="Europe/Lisbon")
    parser.add_argument("--pr-review-sh", type=Path, default=DEFAULT_PR_REVIEW_SH)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)

    try:
        prompt = assemble(
            (SKILL_DIR / "run.md").read_text(),
            review_prompt=extract_review_prompt(args.pr_review_sh.read_text()),
            brief_format=(SKILL_DIR / "brief-format.md").read_text(),
            github_login=args.github_login,
            timezone=args.timezone,
            artifact_url=args.artifact_url,
        )
    except (OSError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1

    if args.out:
        args.out.write_text(prompt)
    else:
        sys.stdout.write(prompt)
    print(f"assembled prompt: {len(prompt.encode())} bytes", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
