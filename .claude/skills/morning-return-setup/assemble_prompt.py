#!/usr/bin/env python3
"""Build the prompt the Morning brief Routine stores.

With this repository attached to the Routine (the default, --mode stub), the
prompt is short: the page, login and timezone, and an instruction to run the
morning-return-run skill, which the Routine's session loads from the repo.
Without it (--mode full), the prompt carries every file of the run, in the
orchestrator's order, with those values filled in.
"""

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUN_DIR = REPO / ".claude" / "skills" / "morning-return-run"

# The run's files, in the order the full prompt carries them. The review
# prompt goes last and is never scanned for placeholders: it has its own.
ORDER = (
    "SKILL.md",
    "rules.md",
    "brief-format.md",
    "parts.md",
    "github.md",
    "comms.md",
    "calendar.md",
    "meeting-prep.md",
    "linear.md",
    "people.md",
    "reviews.md",
)
REVIEW_PROMPT = "review-prompt.md"

PLACEHOLDERS = {"GITHUB_LOGIN", "TIMEZONE", "ARTIFACT_URL"}
PLACEHOLDER_RE = re.compile(r"\{\{([A-Z_]+)\}\}")
ARTIFACT_URL_RE = re.compile(r"^https://claude\.ai/(code/)?artifact/[A-Za-z0-9_-]+$")
GITHUB_LOGIN_RE = re.compile(r"^[A-Za-z0-9-]{1,39}$")
FRONT_MATTER_RE = re.compile(r"\A---\n.*?\n---\n+", re.DOTALL)

STUB = """Run my morning return.

Page: {artifact_url}
GitHub login: {github_login}
Timezone: {timezone}

Use the `morning-return-run` skill from the heuels/morning-return repository
attached to this Routine, and follow its SKILL.md. If the skill isn't listed,
read `.claude/skills/morning-return-run/SKILL.md` in that repository's checkout.
If the repository isn't checked out in this session, stop and say so in one
line instead of improvising the run.
"""

FULL_HEADER = """This prompt carries every file of the morning-return run, each under a
"File:" heading. Where one file names another (rules.md, github.md and so on),
it means that file's section below. Start with SKILL.md.
"""


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


def check(*, github_login: str, artifact_url: str) -> None:
    if not ARTIFACT_URL_RE.match(artifact_url):
        raise ValueError(f"not a claude.ai artifact URL: {artifact_url!r}")
    if not GITHUB_LOGIN_RE.match(github_login):
        raise ValueError(f"not a GitHub login: {github_login!r}")


def strip_front_matter(text: str) -> str:
    return FRONT_MATTER_RE.sub("", text, count=1)


def fill(text: str, *, github_login: str, timezone: str, artifact_url: str) -> str:
    values = {"GITHUB_LOGIN": github_login, "TIMEZONE": timezone, "ARTIFACT_URL": artifact_url}
    return PLACEHOLDER_RE.sub(lambda m: values.get(m[1], m[0]), text)


def stub(*, github_login: str, timezone: str, artifact_url: str) -> str:
    check(github_login=github_login, artifact_url=artifact_url)
    return STUB.format(github_login=github_login, timezone=timezone, artifact_url=artifact_url)


def full(files: dict[str, str], review_prompt: str, *, github_login: str, timezone: str, artifact_url: str) -> str:
    """Join the run's files in ORDER, values filled, the review prompt last."""
    check(github_login=github_login, artifact_url=artifact_url)
    found = {name for text in files.values() for name in PLACEHOLDER_RE.findall(text)}
    if unknown := found - PLACEHOLDERS:
        raise ValueError(f"unknown placeholders in the run: {', '.join(sorted(unknown))}")
    values = {"github_login": github_login, "timezone": timezone, "artifact_url": artifact_url}
    sections = [f"# File: {name}\n\n{fill(strip_front_matter(files[name]), **values).strip()}" for name in ORDER]
    sections.append(f"# File: {REVIEW_PROMPT}\n\n{review_prompt.strip()}")
    settings = f"Page: {artifact_url}\nGitHub login: {github_login}\nTimezone: {timezone}\n"
    return f"{settings}\n{FULL_HEADER}\n---\n\n" + "\n\n---\n\n".join(sections) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mode", choices=("stub", "full"), default="stub")
    parser.add_argument("--github-login")
    parser.add_argument("--artifact-url")
    parser.add_argument("--timezone", default="Europe/Lisbon")
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--sync-review-prompt",
        type=Path,
        metavar="PR_REVIEW_SH",
        help="refresh review-prompt.md from taxwire-skills' pr-review.sh, then exit",
    )
    args = parser.parse_args(argv)

    try:
        if args.sync_review_prompt:
            prompt = extract_review_prompt(args.sync_review_prompt.read_text())
            (RUN_DIR / REVIEW_PROMPT).write_text(prompt + "\n")
            print(f"updated {REVIEW_PROMPT}", file=sys.stderr)
            return 0
        if not (args.github_login and args.artifact_url):
            parser.error("--github-login and --artifact-url are required")
        values = {"github_login": args.github_login, "timezone": args.timezone, "artifact_url": args.artifact_url}
        if args.mode == "stub":
            prompt = stub(**values)
        else:
            files = {name: (RUN_DIR / name).read_text() for name in ORDER}
            prompt = full(files, (RUN_DIR / REVIEW_PROMPT).read_text(), **values)
    except (OSError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1

    if args.out:
        args.out.write_text(prompt)
    else:
        sys.stdout.write(prompt)
    print(f"{args.mode} prompt: {len(prompt.encode())} bytes", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
