#!/usr/bin/env python3
"""Turn one review's markdown into a `reviews` document.

Usage: review_doc.py --scratch <dir> --markdown <file> --id <review id> --reviewed-at <iso>

Reads the Totals and Verdict lines of the review's Summary, writes
<scratch>/reviews/<id>.json as brief-format.md's `reviews` record, and adds
the id to the `review_ids` hand-off in <scratch>/parts/reviews.json. When the
Summary doesn't parse it writes nothing and exits 1: the next run reviews
that commit again.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import contract

TOTALS = re.compile(r"^-\s*Totals:\s*Critical\s+(\d+),\s*High\s+(\d+),\s*Medium\s+(\d+),\s*Low\s+(\d+)", re.IGNORECASE | re.MULTILINE)
VERDICT = re.compile(r"^-\s*Verdict:\s*(blocking|needs-work|minor|ship-ready)\b", re.IGNORECASE | re.MULTILINE)


def parse_summary(markdown):
    """Return ({critical, high, medium, low}, verdict), or raise ValueError naming the missing line."""
    totals = TOTALS.search(markdown)
    if not totals:
        raise ValueError("no Totals line")
    verdict = VERDICT.search(markdown)
    if not verdict:
        raise ValueError("no Verdict line")
    counts = dict(zip(("critical", "high", "medium", "low"), (int(n) for n in totals.groups())))
    return counts, verdict[1].lower()


def parse_id(review_id):
    owner, name, number, head_sha = review_id.split(":")
    return f"{owner}/{name}", int(number), head_sha


def write_review(scratch, markdown, review_id, reviewed_at):
    counts, verdict = parse_summary(markdown)
    repo, number, head_sha = parse_id(review_id)
    doc = {
        "repo": repo,
        "number": number,
        "head_sha": head_sha,
        "reviewed_at": reviewed_at,
        "verdict": verdict,
        "counts": counts,
        "markdown": markdown,
    }
    (scratch / "reviews").mkdir(exist_ok=True)
    (scratch / "reviews" / f"{review_id}.json").write_text(json.dumps(doc, ensure_ascii=False) + "\n")
    contract.update_handoffs(scratch, "reviews", {"review_ids": {f"{repo}#{number}": review_id}})
    return doc


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--reviewed-at", required=True)
    args = parser.parse_args(argv)
    try:
        write_review(args.scratch, args.markdown.read_bytes().decode("utf-8"), args.id, args.reviewed_at)
    except (OSError, ValueError) as err:
        print(f"{args.id}: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
