#!/usr/bin/env python3
"""Choose the review prompt for this run: /pr-review's own, or the saved copy.

Usage: review_prompt.py --scratch <dir> [--script <pr-review.sh>] --copy <review-prompt.md>

Reviews are /pr-review reviews. The prompt is the heredoc in that skill's
pr-review.sh (taxwire-skills), read fresh each run. It is used when it still
carries the four @@…@@ placeholders and an output template whose Summary
review_doc.py can read; otherwise the saved copy is used. Writes
<scratch>/review-prompt.md and records the choice as the `prompt` hand-off
in <scratch>/parts/reviews.json.
"""

import argparse
import re
import sys
from pathlib import Path

import contract
from review_doc import parse_summary

PLACEHOLDERS = ("@@HEAD_BRANCH@@", "@@BASE_BRANCH@@", "@@HEAD_SHA@@", "@@REPO@@")


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


def problem(prompt):
    """Why `prompt` can't be used for the morning's reviews, or None."""
    missing = next((p for p in PLACEHOLDERS if p not in prompt), None)
    if missing:
        return f"no {missing}"
    sample = re.sub(r"<n>", "1", prompt)
    sample = re.sub(r"<\s*([a-z-]+)\s*(\|[^>]*)?>", r"\1", sample)
    try:
        parse_summary(sample)
    except ValueError as err:
        return str(err)
    return None


def choose(scratch, script, copy):
    try:
        text = script.read_text() if script else None
    except OSError:
        text = None
    if text is None:
        why = "pr-review.sh couldn't be read"
    else:
        try:
            live = extract_review_prompt(text)
            why = problem(live)
        except ValueError:
            why = "no prompt in pr-review.sh"
    if why is None:
        (scratch / "review-prompt.md").write_text(live.strip() + "\n")
        choice = "live"
    else:
        (scratch / "review-prompt.md").write_text(copy.read_text())
        choice = f"copy: {why}"
    contract.update_handoffs(scratch, "reviews", {"prompt": choice})
    return choice


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--script", type=Path)
    parser.add_argument("--copy", type=Path, required=True)
    args = parser.parse_args(argv)
    print(choose(args.scratch, args.script, args.copy))
    return 0


if __name__ == "__main__":
    sys.exit(main())
