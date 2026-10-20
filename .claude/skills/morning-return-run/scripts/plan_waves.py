#!/usr/bin/env python3
"""Name the passes of a wave that have work, so the rest are never started.

Usage: plan_waves.py --run-dir <skill dir> --scratch <dir> --wave 2|3

Reads the earlier parts from <scratch>/parts/, prints one pass name per line,
and records them in <scratch>/plan.json, which merge_brief.py reads to tell
a pass that didn't finish from one that was never started.
"""

import argparse
import json
import sys
from pathlib import Path

import contract


def _part(parts, name):
    value = parts.get(name)
    return value if isinstance(value, dict) else {}


def _handoff(parts, name, key, default):
    return (_part(parts, name).get("handoffs") or {}).get(key, default)


def _prs(parts):
    fields = _part(parts, "github").get("fields") or {}
    return [pr for key in contract.PR_LISTS for pr in fields.get(key) or []]


def _external_meeting(parts):
    keys = _handoff(parts, "calendar", "meeting_keys", [])
    return any(k.get("external_domains") for k in keys) or bool(_handoff(parts, "gmail", "invites", []))


def _names_to_match(parts):
    identities = _handoff(parts, "github", "commit_identities", {})
    unmatched = [
        login
        for login, found in identities.items()
        if not any((i.get("email") or "").lower().endswith("@" + contract.TEAM_DOMAIN) for i in found)
    ]
    return bool(unmatched or _handoff(parts, "calendar", "ooo_names", []) or _handoff(parts, "linear", "linear_names", []))


def _linked_outside(parts):
    open_urls = {pr.get("url") for pr in _prs(parts)}
    issues = _handoff(parts, "linear-enrich", "issues", {})
    return any(url not in open_urls for issue in issues.values() for url in issue.get("pr_urls", []))


# Each later pass, and when it has something to do. Order follows parts.md.
RULES = {
    "slack-enrich": lambda p: bool(_prs(p)) or _external_meeting(p) or _names_to_match(p),
    "gmail-enrich": _external_meeting,
    "linear-enrich": lambda p: any(pr.get("linear_id") for pr in _prs(p)),
    "meetings": lambda p: bool(_handoff(p, "calendar", "events", []) or _handoff(p, "gmail", "invites", [])),
    "github-enrich": _linked_outside,
}


def plan(parts, wave, parts_text):
    owners = contract.ownership(parts_text)
    return [name for name, owner in owners.items() if owner.wave == wave and RULES[name](parts)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--wave", type=int, choices=(2, 3), required=True)
    args = parser.parse_args(argv)

    parts_text = (args.run_dir / "parts.md").read_text()
    names = [name for name in contract.ownership(parts_text) if name not in {"header", "merge"}]
    passes = plan(contract.read_parts(args.scratch, names), args.wave, parts_text)
    record = contract.read_json(args.scratch / "plan.json")
    record = record if isinstance(record, dict) else {}
    record[str(args.wave)] = passes
    (args.scratch / "plan.json").write_text(json.dumps(record) + "\n")
    print("\n".join(passes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
