#!/usr/bin/env python3
"""Turn the run's part files into the brief, check it, and list the writes.

Usage: merge_brief.py --run-dir <skill dir> --scratch <dir> [--skip <part> ...]

Reads <scratch>/header.json, <scratch>/parts/<part>.json for every part in
parts.md, <scratch>/plan.json (the passes plan_waves.py started) and the
review documents in <scratch>/reviews/. Writes <scratch>/brief.json and
<scratch>/writes.json, the `ArtifactData` batch entries for the new reviews,
and prints the run's three Finish lines. With errors it writes nothing and
exits 1, one error per line on stderr.

This is the only place a hand-off becomes a brief field.
"""

import argparse
import copy
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import contract

PR_LISTS = contract.PR_LISTS
ASK_LISTS = ("mail_asks", "slack_asks")
PART_KEYS = {"sources", "fields", "notes", "handoffs"}
SPECIAL = {"header", "merge", "reviews"}
DOC_ID = re.compile(r"^[A-Za-z0-9._~:@+-]{1,200}$")
PR_URL = re.compile(r"^https://github\.com/([^/]+/[^/]+)/pull/(\d+)")
MAX_NOTES = 4
MAX_DISCUSSIONS = 8

# What the brief lacks when a later pass didn't finish.
MISSING = {
    "slack-enrich": "Slack enrichment didn't finish: PR discussions, blocking signals and some emails may be missing.",
    "gmail-enrich": "Gmail enrichment didn't finish: meeting context may miss earlier mail.",
    "linear-enrich": "Linear enrichment didn't finish: PRs aren't grouped under their Linear issues.",
    "meetings": "Meeting prep didn't finish: meetings have no context or prep.",
    "github-enrich": "GitHub enrichment didn't finish: linked PRs outside the brief aren't listed.",
}


def _check_part(name, value, owner):
    if not isinstance(value, dict):
        return [f"{name}: not a part object"]
    errors = [f"{name}: unknown key {key}" for key in sorted(value.keys() - PART_KEYS)]
    fields, sources, handoffs = (value.get(key) or {} for key in ("fields", "sources", "handoffs"))
    errors += [f"{name}: doesn't own {key}" for key in sorted(fields.keys() - owner.fields)]
    errors += [f"{name}: missing {key}" for key in sorted(owner.fields - fields.keys())]
    errors += [f"{name}: doesn't own source {key}" for key in sorted(sources.keys() - owner.sources)]
    errors += [f"{name}: missing source {key}" for key in sorted(owner.sources - sources.keys())]
    errors += [f"{name}: doesn't declare {key}" for key in sorted(handoffs.keys() - owner.handoffs)]
    if not all(isinstance(note, str) for note in value.get("notes") or []):
        errors.append(f"{name}: notes aren't sentences")
    return errors


def _empty(field, fields):
    return {key: [] for key in fields["Linear"]} if field == "linear" else []


def _handoff(parts, name, key, default):
    part = parts.get(name)
    return copy.deepcopy((part.get("handoffs") or {}).get(key, default)) if isinstance(part, dict) else default


def _pr_key(repo, number):
    return f"{repo}#{number}"


def _short_repo(repo):
    return repo.split("/")[-1].removeprefix("taxwire-")


def _clock(iso, zone):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(zone).strftime("%H:%M")


def _same_meeting(a, b):
    return a["start"] == b["start"] and a["title"].strip().casefold() == b["title"].strip().casefold()


def _meetings(parts):
    if isinstance(parts.get("meetings"), dict):
        return copy.deepcopy(parts["meetings"]["fields"]["meetings"])
    events = _handoff(parts, "calendar", "events", [])
    invites = [i for i in _handoff(parts, "gmail", "invites", []) if not any(_same_meeting(i, e) for e in events)]
    return sorted(events + invites, key=lambda m: datetime.fromisoformat(m["start"].replace("Z", "+00:00")))


def _email_for(login, identities, names):
    found = identities.get(login) or []
    for identity in found:
        email = (identity.get("email") or "").lower()
        if email.endswith("@" + contract.TEAM_DOMAIN):
            return email
    return next((names[i["name"]] for i in found if names.get(i.get("name"))), None)


def _fill_emails(brief, parts):
    identities = _handoff(parts, "github", "commit_identities", {})
    names = _handoff(parts, "slack-enrich", "names", {})
    for key in PR_LISTS:
        for pr in brief[key]:
            pr["author_email"] = pr["author_email"] or _email_for(pr["author"], identities, names)
            for reviewer in pr["requested_reviewers"]:
                reviewer["email"] = reviewer["email"] or _email_for(reviewer["login"], identities, names)


def _mentions(parts):
    seen, out = set(), []
    for mention in _handoff(parts, "slack-enrich", "pr_mentions", []) + _handoff(parts, "slack", "pr_links", []):
        if mention.get("url") not in seen:
            seen.add(mention.get("url"))
            out.append(mention)
    return out


def _fill_blocking(brief, parts):
    mentions = _mentions(parts)
    for pr in brief["review_prs"]:
        if pr["blocking_signal"]:
            continue
        pings = (
            m
            for m in mentions
            if m.get("to_me")
            and m.get("pr") == {"repo": pr["repo"], "number": pr["number"]}
            and (pr["author_email"] is None or m.get("from_email") == pr["author_email"])
        )
        pr["blocking_signal"] = next((m["line"] for m in pings), None)


def _add_discussions(brief, parts, item_fields):
    mine = {(pr["repo"], pr["number"]) for pr in brief["my_prs"]}
    listed = {item["url"] for key in ("slack_asks", "slack_discussions") for item in brief[key]}
    for mention in _handoff(parts, "slack-enrich", "pr_mentions", []):
        pr = mention.get("pr") or {}
        if len(brief["slack_discussions"]) >= MAX_DISCUSSIONS:
            break
        if (pr.get("repo"), pr.get("number")) not in mine or mention.get("url") in listed:
            continue
        item = {key: mention.get(key) for key in item_fields}
        item["tag"] = item["tag"] or f"{_short_repo(pr['repo'])}#{pr['number']}"
        brief["slack_discussions"].append(item)
        listed.add(item["url"])


def _tag_asks(brief, parts):
    zone = ZoneInfo(brief["timezone"])
    senders = _handoff(parts, "gmail", "senders", {}) | _handoff(parts, "slack", "ask_senders", {})
    for key in ASK_LISTS:
        for item in brief[key]:
            sender = senders.get(item["url"])
            meeting = next((m for m in brief["meetings"] if sender and sender in {a.get("email") for a in m["attendees"]}), None)
            if item["tag"] or meeting is None:
                continue
            start = _clock(meeting["start"], zone)
            item["tag"] = f"{meeting['org'] or meeting['title']} {start}"
            if item["action"] and not item["action"].get("by"):
                item["action"]["by"] = start


def _fill_out_of_office(brief, parts):
    names = _handoff(parts, "slack-enrich", "names", {})
    for entry in brief["out_of_office"]:
        entry["email"] = entry["email"] or names.get(entry["name"])
    brief["out_of_office"] = [entry for entry in brief["out_of_office"] if entry["email"]]


def _linear_issues(brief, parts):
    open_urls = {pr["url"] for key in PR_LISTS for pr in brief[key]}
    states = _handoff(parts, "github-enrich", "pr_states", {})
    issues = {}
    for identifier, issue in _handoff(parts, "linear-enrich", "issues", {}).items():
        prs = []
        for url in issue.get("pr_urls", []):
            match = PR_URL.match(url)
            state = "open" if url in open_urls else states.get(url)
            if match and state:
                prs.append({"repo": match[1], "number": int(match[2]), "url": url, "state": state})
        issues[identifier] = {key: issue.get(key) for key in ("title", "url", "status")} | {"prs": prs}
    return issues


def _fill_review_ids(brief, parts):
    ids = _handoff(parts, "reviews", "review_ids", {})
    for key in ("review_prs", "my_prs"):
        for pr in brief[key]:
            pr["review_id"] = pr["review_id"] or ids.get(_pr_key(pr["repo"], pr["number"]))


def _review_notes(parts):
    queued = _handoff(parts, "reviews", "queued", 0)
    prompt = _handoff(parts, "reviews", "prompt", "live")
    notes = []
    if queued:
        notes.append(f"{queued} review{'s' if queued != 1 else ''} queued for the next run ({contract.REVIEW_LIMIT} per run).")
    if prompt != "live":
        notes.append(f"Reviews used the saved copy of the /pr-review prompt: {prompt.removeprefix('copy: ')}.")
    return notes


def merge(header, parts, format_text, parts_text, *, new_reviews=(), started=None):
    """Return (brief, writes, errors) for the given header and parts.

    `parts` maps each part name to its JSON, or None when it is missing or
    didn't parse. `started` names the later passes plan_waves.py started;
    None means all of them. `new_reviews` are the review ids written this run.
    """
    fields = contract.brief_fields(format_text)
    owners = contract.ownership(parts_text)
    errors = [f"header: missing {key}" for key in sorted(owners["header"].fields - {"notes"} - header.keys())]
    usable, missing_notes = {}, []
    for name, owner in owners.items():
        value = parts.get(name)
        if name in SPECIAL:
            usable[name] = value if isinstance(value, dict) else None
            continue
        problems = _check_part(name, value, owner) if value is not None else []
        errors += problems
        usable[name] = value if value is not None and not problems else None
        if value is None and owner.wave > 1 and (started is None or name in started):
            missing_notes.append(MISSING.get(name, f"{name} didn't finish."))

    brief = {key: copy.deepcopy(header[key]) for key in owners["header"].fields - {"notes"} if key in header}
    brief["sources"] = {}
    for name, owner in owners.items():
        if owner.wave != 1:
            continue
        part = usable[name]
        for source in owner.sources:
            brief["sources"][source] = copy.deepcopy(part["sources"][source]) if part else {"ok": False, "error": f"{owner.unit} didn't finish"}
        for field in owner.fields:
            brief[field] = copy.deepcopy(part["fields"][field]) if part else _empty(field, fields)
    if errors:
        return brief, [], errors

    brief["meetings"] = _meetings(usable)
    _fill_emails(brief, usable)
    _fill_blocking(brief, usable)
    _add_discussions(brief, usable, fields["Item"])
    _tag_asks(brief, usable)
    _fill_out_of_office(brief, usable)
    brief["linear_issues"] = _linear_issues(brief, usable)
    _fill_review_ids(brief, usable)

    writes, bad_ids = [], []
    for doc_id in new_reviews:
        if DOC_ID.match(doc_id):
            writes.append({"op": "set", "collection": "reviews", "doc_id": doc_id, "file_path": f"reviews/{doc_id}.json"})
        else:
            bad_ids.append(f"Review {doc_id} wasn't saved: its id isn't a valid document id.")

    later = [usable[n] for n, o in owners.items() if n not in SPECIAL and o.wave and o.wave > 1]
    base = [usable[n] for n, o in owners.items() if o.wave == 1]
    notes = list(header.get("notes") or []) + _review_notes(usable) + missing_notes + bad_ids
    notes += [note for part in base + later if part for note in part.get("notes") or []]
    brief["notes"] = notes[:MAX_NOTES]
    for dropped in notes[MAX_NOTES:]:
        print(f"note dropped: {dropped}", file=sys.stderr)

    return brief, writes, contract.validate(brief, fields)


def finish_lines(brief, parts, *, new_reviews=()):
    counts = " · ".join(f"{key} {len(value)}" for key, value in brief.items() if isinstance(value, list) and key != "notes")
    ids = _handoff(parts, "reviews", "review_ids", {})
    already = len([i for i in ids.values() if i not in set(new_reviews)])
    queued = _handoff(parts, "reviews", "queued", 0)
    failed = [f"{name} ({entry.get('error')})" for name, entry in brief["sources"].items() if not entry.get("ok")]
    return [
        counts,
        f"Reviews: {len(new_reviews)} run, {already} already reviewed, {queued} queued",
        f"Failed: {'; '.join(failed)}" if failed else "No source failed",
    ]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--skip", action="append", default=[])
    args = parser.parse_args(argv)

    format_text = (args.run_dir / "brief-format.md").read_text()
    parts_text = (args.run_dir / "parts.md").read_text()
    names = [name for name in contract.ownership(parts_text) if name not in {"header", "merge"}]
    parts = contract.read_parts(args.scratch, names)
    for name in args.skip:
        parts[name] = None
    header = contract.read_json(args.scratch / "header.json")
    if not isinstance(header, dict):
        print("header.json is missing or isn't JSON", file=sys.stderr)
        return 1
    plan = contract.read_json(args.scratch / "plan.json")
    started = {name for wave in plan.values() for name in wave} if isinstance(plan, dict) else None
    new_reviews = sorted(path.stem for path in (args.scratch / "reviews").glob("*.json"))

    brief, writes, errors = merge(header, parts, format_text, parts_text, new_reviews=new_reviews, started=started)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    for write in writes:
        write["file_path"] = str((args.scratch / write["file_path"]).resolve())
    (args.scratch / "brief.json").write_text(json.dumps(brief, indent=2, ensure_ascii=False) + "\n")
    (args.scratch / "writes.json").write_text(json.dumps(writes, indent=2) + "\n")
    print("\n".join(finish_lines(brief, parts, new_reviews=new_reviews)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
