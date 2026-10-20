#!/usr/bin/env python3
"""Decide which PRs get a first-pass review this run.

Usage:
  review_queue.py ids --scratch <dir>
  review_queue.py pick --scratch <dir> --existing-dir <dir> [--limit 8]

`ids` prints every candidate's review id, one per line, in reviews.md's
order. The orchestrator fetches each with `ArtifactData` `get` and `out_dir`
<existing-dir>, which saves the ones that exist as
<existing-dir>/reviews/<id>.json. `pick` then prints the reviews to run as
JSON, `{"run": [...], "queued": n}`, and records the existing reviews' ids
and the queued count in <scratch>/parts/reviews.json.

Everything here reaches git on the orchestrator's command line, so a PR is a
candidate only when its repo, number, head SHA and branch names look like
what GitHub gives, and its clone URL is always GitHub's own.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import contract

REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
SHA = re.compile(r"^[0-9a-f]{40}$")
REF = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]*$")


def _part(scratch, name):
    value = contract.read_json(scratch / "parts" / f"{name}.json")
    return value if isinstance(value, dict) else {}


def _list(value):
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


def review_id(pr):
    owner, name = pr["repo"].split("/")
    return f"{owner}:{name}:{pr['number']}:{pr['head_sha']}"


def _number(value):
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return int(value) if isinstance(value, str) and value.isdigit() else None


def _usable(pr):
    """The PR with a whole-number `number`, or None when git shouldn't see it."""
    number = _number(pr.get("number"))
    if number is None or not REPO.match(str(pr.get("repo"))) or not SHA.match(str(pr.get("head_sha"))):
        return None
    return pr | {"number": number}


def _safe_refs(pr):
    return all(isinstance(pr.get(key), str) and REF.match(pr[key]) and ".." not in pr[key] for key in ("head_ref", "base_ref"))


def _size(pr):
    return sum(n for n in (pr.get("additions"), pr.get("deletions")) if isinstance(n, int))


def _when(pr, key):
    return str(pr.get(key) or pr.get("created_at") or "")


def candidates(scratch, skipped=None):
    github = _part(scratch, "github")
    fields = github.get("fields") if isinstance(github.get("fields"), dict) else {}
    pinged = set()
    for link in _list((_part(scratch, "slack").get("handoffs") or {}).get("pr_links")):
        pr = link.get("pr") if isinstance(link.get("pr"), dict) else {}
        if link.get("to_me") is True and _number(pr.get("number")) is not None:
            pinged.add((pr.get("repo"), _number(pr["number"])))
    finished = {
        (b.get("repo"), b.get("branch"))
        for b in _list((_part(scratch, "sessions").get("handoffs") or {}).get("branches"))
        if b.get("finished") is True
    }

    review = [pr for pr in map(_usable, _list(fields.get("review_prs"))) if pr]
    review.sort(key=lambda pr: ((pr["repo"], pr["number"]) not in pinged, _when(pr, "waiting_since"), _size(pr)))
    mine = [pr for pr in map(_usable, _list(fields.get("my_prs"))) if pr]
    mine = sorted(
        (pr for pr in mine if pr.get("draft") is not True or (pr["repo"], pr.get("head_ref")) in finished),
        key=lambda pr: _when(pr, "created_at"),
    )

    seen, out = set(), []
    for pr in review + mine:
        rid = review_id(pr)
        if rid in seen:
            continue
        seen.add(rid)
        if not _safe_refs(pr):
            if skipped is not None:
                skipped.append(f"{pr['repo']}#{pr['number']}")
            continue
        out.append(
            {key: pr[key] for key in ("repo", "number", "head_sha", "head_ref", "base_ref")}
            | {"id": rid, "clone": f"https://github.com/{pr['repo']}.git"}
        )
    return out


def existing_ids(existing_dir):
    """The review ids `ArtifactData` `get` saved under <existing_dir>/reviews/."""
    return {path.stem for path in (Path(existing_dir) / "reviews").glob("*.json")}


def pick(scratch, existing, limit=contract.REVIEW_LIMIT):
    skipped = []
    found = candidates(scratch, skipped)
    done = [c for c in found if c["id"] in existing]
    todo = [c for c in found if c["id"] not in existing]
    queued = max(len(todo) - limit, 0)
    part = contract.update_handoffs(
        scratch,
        "reviews",
        {"review_ids": {f"{c['repo']}#{c['number']}": c["id"] for c in done}, "queued": queued},
    )
    if skipped:
        part["notes"] = list(part.get("notes") or []) + [f"Not reviewed: {', '.join(skipped)} has a branch name git shouldn't be given."]
        (scratch / "parts" / "reviews.json").write_text(json.dumps(part, indent=2) + "\n")
    return {"run": todo[:limit], "queued": queued}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("ids", "pick"))
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--existing-dir", type=Path)
    parser.add_argument("--limit", type=int, default=contract.REVIEW_LIMIT)
    args = parser.parse_args(argv)
    if args.command == "ids":
        print("\n".join(c["id"] for c in candidates(args.scratch)))
        return 0
    if args.existing_dir is None:
        parser.error("pick needs --existing-dir")
    print(json.dumps(pick(args.scratch, existing_ids(args.existing_dir), args.limit), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
