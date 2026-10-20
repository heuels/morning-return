#!/usr/bin/env python3
"""Decide which PRs get a first-pass review this run.

Usage:
  review_queue.py ids --scratch <dir>
  review_queue.py pick --scratch <dir> --existing <file> [--limit 8]

`ids` prints every candidate's review id, one per line, in reviews.md's
order. The orchestrator checks which already have a `reviews` document and
lists those in the --existing file. `pick` then prints the reviews to run as
JSON, `{"run": [...], "queued": n}`, and records the existing reviews' ids and
the queued count in <scratch>/parts/reviews.json.
"""

import argparse
import json
import sys
from pathlib import Path

import contract


def _part(scratch, name):
    value = contract.read_json(scratch / "parts" / f"{name}.json")
    return value if isinstance(value, dict) else {}


def review_id(pr):
    owner, name = pr["repo"].split("/")
    return f"{owner}:{name}:{pr['number']}:{pr['head_sha']}"


def candidates(scratch):
    github = _part(scratch, "github")
    fields = github.get("fields") or {}
    pinged = {
        (link["pr"]["repo"], link["pr"]["number"])
        for link in (_part(scratch, "slack").get("handoffs") or {}).get("pr_links", [])
        if link.get("to_me") and link.get("pr")
    }
    finished = {
        (b["repo"], b["branch"]) for b in (_part(scratch, "sessions").get("handoffs") or {}).get("branches", []) if b.get("finished")
    }
    clones = {r["repo"]: r.get("clone") for r in (github.get("handoffs") or {}).get("repos", [])}

    review = sorted(
        fields.get("review_prs") or [],
        key=lambda pr: ((pr["repo"], pr["number"]) not in pinged, pr["waiting_since"], pr["additions"] + pr["deletions"]),
    )
    mine = sorted(
        (pr for pr in fields.get("my_prs") or [] if not pr["draft"] or (pr["repo"], pr["head_ref"]) in finished),
        key=lambda pr: pr["created_at"],
    )
    seen, out = set(), []
    for pr in review + mine:
        rid = review_id(pr)
        if rid not in seen:
            seen.add(rid)
            out.append(
                {key: pr[key] for key in ("repo", "number", "head_sha", "head_ref", "base_ref")} | {"id": rid, "clone": clones.get(pr["repo"])}
            )
    return out


def pick(scratch, existing, limit=contract.REVIEW_LIMIT):
    found = candidates(scratch)
    done = [c for c in found if c["id"] in existing]
    todo = [c for c in found if c["id"] not in existing]
    contract.update_handoffs(
        scratch,
        "reviews",
        {"review_ids": {f"{c['repo']}#{c['number']}": c["id"] for c in done}, "queued": max(len(todo) - limit, 0)},
    )
    return {"run": todo[:limit], "queued": max(len(todo) - limit, 0)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("ids", "pick"))
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--existing", type=Path)
    parser.add_argument("--limit", type=int, default=contract.REVIEW_LIMIT)
    args = parser.parse_args(argv)
    if args.command == "ids":
        print("\n".join(c["id"] for c in candidates(args.scratch)))
        return 0
    if args.existing is None:
        parser.error("pick needs --existing")
    existing = set(args.existing.read_text().split()) if args.existing.exists() else set()
    print(json.dumps(pick(args.scratch, existing, args.limit), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
