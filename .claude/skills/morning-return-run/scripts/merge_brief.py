#!/usr/bin/env python3
"""Turn the run's part files into the brief, check it, and list the writes.

Usage: merge_brief.py --run-dir <skill dir> --scratch <dir> [--skip <part> ...]

Reads <scratch>/header.json, <scratch>/parts/<part>.json for every part in
parts.md, <scratch>/plan.json (the passes plan_waves.py started) and the
review documents in <scratch>/reviews/. Writes <scratch>/brief.json and
<scratch>/writes.json, the `ArtifactData` batch entries for the new reviews,
and prints the run's three Finish lines.

Problems in the parts never stop it: a record the page couldn't use is left
out with a note, and each problem is printed to stderr as `<part>: …`, so the
orchestrator can rerun that pass once. It exits 1, writing nothing, only when
there's no brief to write (the header is unusable).

This is the only place a hand-off becomes a brief field.
"""

import argparse
import copy
import json
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import contract
from clean_parts import clean_part, clean_record, empty, parse_time

PR_LISTS = contract.PR_LISTS
ASK_LISTS = ("mail_asks", "slack_asks")
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


class MergeError(Exception):
    """There is no brief to write."""


def _handoff(parts, name, key, default):
    part = parts.get(name)
    value = (part.get("handoffs") or {}).get(key, default) if isinstance(part, dict) else default
    return copy.deepcopy(value) if isinstance(value, type(default)) else default


def _pr_key(repo, number):
    return f"{repo}#{number}"


def _short_repo(repo):
    return repo.split("/")[-1].removeprefix("taxwire-")


def _same_meeting(a, b, zone):
    start_a, start_b = parse_time(a.get("start"), zone), parse_time(b.get("start"), zone)
    same_title = str(a.get("title") or "").strip().casefold() == str(b.get("title") or "").strip().casefold()
    return start_a is not None and start_a == start_b and same_title


def _meetings(parts, zone, fields, problems):
    if isinstance(parts.get("meetings"), dict):
        return parts["meetings"]["fields"]["meetings"]
    found = []
    for source, key in (("calendar", "events"), ("gmail", "invites")):
        for i, raw in enumerate(_handoff(parts, source, key, [])):
            record, why = clean_record(raw, "Meeting", fields, zone)
            if record is None:
                problems.append(f"{source}: {key}[{i}]: {why}")
            else:
                found.append(record)
    events = [m for m in found if m["on_calendar"]]
    invites = [m for m in found if not m["on_calendar"] and not any(_same_meeting(m, e, zone) for e in events)]
    return sorted(events + invites, key=lambda m: parse_time(m["start"], zone))


def _identities(identities, login):
    found = identities.get(login)
    found = [found] if isinstance(found, dict) else found if isinstance(found, list) else []
    return [i for i in found if isinstance(i, dict)]


def _email_for(login, identities, names):
    found = _identities(identities, login)
    for identity in found:
        email = str(identity.get("email") or "").lower()
        if email.endswith("@" + contract.TEAM_DOMAIN):
            return email
    return next((names[i["name"]] for i in found if isinstance(i.get("name"), str) and isinstance(names.get(i["name"]), str)), None)


def _fill_emails(brief, parts):
    identities = _handoff(parts, "github", "commit_identities", {})
    names = _handoff(parts, "slack-enrich", "names", {})
    for key in PR_LISTS:
        for pr in brief[key]:
            pr["author_email"] = pr["author_email"] or _email_for(pr["author"], identities, names)
            for reviewer in pr["requested_reviewers"]:
                reviewer["email"] = reviewer.get("email") or _email_for(reviewer["login"], identities, names)


def _pr_of(mention):
    pr = mention.get("pr") if isinstance(mention.get("pr"), dict) else {}
    number = pr.get("number")
    number = int(number) if isinstance(number, str) and number.isdigit() else number
    return (pr.get("repo"), number) if isinstance(pr.get("repo"), str) and isinstance(number, int) else None


def _mentions(parts):
    seen, out = set(), []
    for mention in _handoff(parts, "slack-enrich", "pr_mentions", []) + _handoff(parts, "slack", "pr_links", []):
        if isinstance(mention, dict) and isinstance(mention.get("url"), str) and mention["url"] not in seen and _pr_of(mention):
            seen.add(mention["url"])
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
            if m.get("to_me") is True
            and _pr_of(m) == (pr["repo"], pr["number"])
            and isinstance(m.get("line"), str)
            and (pr["author_email"] is None or m.get("from_email") == pr["author_email"])
        )
        pr["blocking_signal"] = next((m["line"] for m in pings), None)


def _add_discussions(brief, parts, item_fields):
    mine = {(pr["repo"], pr["number"]) for pr in brief["my_prs"]}
    listed = {item["url"] for key in ("slack_asks", "slack_discussions") for item in brief[key]}
    for mention in _mentions(parts):
        if len(brief["slack_discussions"]) >= MAX_DISCUSSIONS:
            break
        if mention not in _handoff(parts, "slack-enrich", "pr_mentions", []):
            continue
        pr = _pr_of(mention)
        if pr not in mine or mention["url"] in listed or not isinstance(mention.get("title"), str):
            continue
        item = {key: mention.get(key) for key in item_fields}
        item["people"] = [p for p in item["people"] or [] if isinstance(p, str)]
        item["action"] = item["action"] if isinstance(item["action"], dict) else None
        item["tag"] = item["tag"] if isinstance(item["tag"], str) else f"{_short_repo(pr[0])}#{pr[1]}"
        brief["slack_discussions"].append(item)
        listed.add(item["url"])


def _outside(meeting):
    return any(not str(a.get("email", "")).lower().endswith("@" + contract.TEAM_DOMAIN) for a in meeting["attendees"])


def _tag_asks(brief, parts, zone):
    senders = _handoff(parts, "gmail", "senders", {}) | _handoff(parts, "slack", "ask_senders", {})
    for key in ASK_LISTS:
        for item in brief[key]:
            sender = senders.get(item["url"]) if isinstance(item["url"], str) else None
            meeting = next(
                (m for m in brief["meetings"] if _outside(m) and sender and sender in {a.get("email") for a in m["attendees"]}),
                None,
            )
            if item["tag"] or meeting is None:
                continue
            start = parse_time(meeting["start"], zone).astimezone(zone).strftime("%H:%M")
            item["tag"] = f"{meeting['org'] or meeting['title']} {start}"
            if item["action"] and not item["action"].get("by"):
                item["action"]["by"] = start


def _fill_out_of_office(brief, parts):
    names = _handoff(parts, "slack-enrich", "names", {})
    for entry in brief["out_of_office"]:
        found = names.get(entry["name"])
        entry["email"] = entry["email"] or (found if isinstance(found, str) else None)
    brief["out_of_office"] = [entry for entry in brief["out_of_office"] if entry["email"]]


def _linear_issues(brief, parts):
    open_urls = {pr["url"] for key in PR_LISTS for pr in brief[key]}
    states = _handoff(parts, "github-enrich", "pr_states", {})
    issues = {}
    for identifier, issue in _handoff(parts, "linear-enrich", "issues", {}).items():
        if not isinstance(issue, dict):
            continue
        prs = []
        for url in issue.get("pr_urls") if isinstance(issue.get("pr_urls"), list) else []:
            match = PR_URL.match(url) if isinstance(url, str) else None
            state = "open" if url in open_urls else states.get(url)
            if match and state in {"open", "merged", "closed"}:
                prs.append({"repo": match[1], "number": int(match[2]), "url": url, "state": state})
        issues[identifier] = {key: issue.get(key) for key in ("title", "url", "status")} | {"prs": prs}
    return issues


def _fill_review_ids(brief, parts):
    ids = _handoff(parts, "reviews", "review_ids", {})
    for key in ("review_prs", "my_prs"):
        for pr in brief[key]:
            found = ids.get(_pr_key(pr["repo"], pr["number"]))
            pr["review_id"] = pr["review_id"] or (found if isinstance(found, str) else None)


def _review_notes(parts):
    queued = _handoff(parts, "reviews", "queued", 0)
    prompt = _handoff(parts, "reviews", "prompt", "live")
    notes = [n for n in (parts.get("reviews") or {}).get("notes") or [] if isinstance(n, str)]
    if queued:
        notes.append(f"{queued} review{'s' if queued != 1 else ''} queued for the next run ({contract.REVIEW_LIMIT} per run).")
    if prompt != "live":
        notes.append(f"Reviews used the saved copy of the /pr-review prompt: {prompt.removeprefix('copy: ')}.")
    return notes


def _zone(header, problems):
    try:
        return ZoneInfo(str(header.get("timezone")))
    except (ZoneInfoNotFoundError, ValueError):
        problems.append(f"header: timezone {header.get('timezone')!r} isn't one; using UTC")
        return ZoneInfo("UTC")


def _dropped_note(name, count):
    entries = "1 entry" if count == 1 else f"{count} entries"
    left = "it was" if count == 1 else "they were"
    return f"The {name} pass wrote {entries} the page can't read; {left} left out."


DERIVATIONS = (
    ("emails", lambda brief, parts, zone, fields: _fill_emails(brief, parts)),
    ("blocking signals", lambda brief, parts, zone, fields: _fill_blocking(brief, parts)),
    ("PR discussions", lambda brief, parts, zone, fields: _add_discussions(brief, parts, fields["Item"])),
    ("meeting tags", lambda brief, parts, zone, fields: _tag_asks(brief, parts, zone)),
    ("out of office", lambda brief, parts, zone, fields: _fill_out_of_office(brief, parts)),
    ("review ids", lambda brief, parts, zone, fields: _fill_review_ids(brief, parts)),
)


def merge(header, parts, format_text, parts_text, *, new_reviews=(), started=None):
    """Return (brief, writes, problems) for the given header and parts.

    `parts` maps each part name to its JSON, or None when it is missing or
    didn't parse. `started` names the later passes plan_waves.py started;
    None means all of them. `new_reviews` are the ids of the review
    documents on disk; only those review_doc.py recorded are written.
    Raises MergeError when the header can't make a brief.
    """
    fields = contract.brief_fields(format_text)
    owners = contract.ownership(parts_text)
    shapes = contract.handoff_shapes(parts_text)
    header = header if isinstance(header, dict) else {}
    missing = sorted(key for key in owners["header"].fields - {"notes"} if header.get(key) is None and key != "since")
    if missing or "since" not in header:
        raise MergeError("\n".join(f"header: missing {key}" for key in missing or ["since"]))
    problems = []
    zone = _zone(header, problems)

    usable, missing_notes, dropped_notes = {}, [], []
    for name, owner in owners.items():
        value = parts.get(name)
        if name in SPECIAL:
            usable[name] = value if isinstance(value, dict) else None
            continue
        usable[name] = clean_part(name, value, owner, fields, shapes, zone, problems) if value is not None else None
        if usable[name] and usable[name]["dropped"]:
            dropped_notes.append(_dropped_note(name, usable[name]["dropped"]))
        if usable[name] is None and owner.wave > 1 and (started is None or name in started):
            missing_notes.append(MISSING.get(name, f"{name} didn't finish."))

    brief = {key: copy.deepcopy(header[key]) for key in owners["header"].fields - {"notes"}}
    brief["sources"] = {}
    for name, owner in owners.items():
        if owner.wave != 1:
            continue
        part = usable[name]
        for source in owner.sources:
            brief["sources"][source] = part["sources"][source] if part else {"ok": False, "error": f"{owner.unit} didn't finish"}
        for field in owner.fields:
            brief[field] = copy.deepcopy(part["fields"][field]) if part else empty(field, fields)

    brief["meetings"] = copy.deepcopy(_meetings(usable, zone, fields, problems))
    for step, apply in DERIVATIONS:
        try:
            apply(brief, usable, zone, fields)
        except Exception as err:  # a derivation never costs the brief
            problems.append(f"merge: {step}: {type(err).__name__}: {err}")
    try:
        brief["linear_issues"] = _linear_issues(brief, usable)
    except Exception as err:
        problems.append(f"merge: linear issues: {type(err).__name__}: {err}")
        brief["linear_issues"] = {}

    recorded = set(_handoff(usable, "reviews", "review_ids", {}).values())
    writes, bad_ids = [], []
    for doc_id in new_reviews:
        if doc_id not in recorded:
            problems.append(f"reviews: {doc_id}.json wasn't recorded by review_doc.py; not written")
        elif DOC_ID.match(doc_id):
            writes.append({"op": "set", "collection": "reviews", "doc_id": doc_id, "file_path": f"reviews/{doc_id}.json"})
        else:
            bad_ids.append(f"Review {doc_id} wasn't saved: its id isn't a valid document id.")

    later = [usable[n] for n, o in owners.items() if n not in SPECIAL and o.wave > 1]
    base = [usable[n] for n, o in owners.items() if o.wave == 1]
    header_notes = header.get("notes") if isinstance(header.get("notes"), list) else []
    notes = [n for n in header_notes if isinstance(n, str)] + _review_notes(usable) + missing_notes + bad_ids + dropped_notes
    notes += [note for part in base + later if part for note in part["notes"]]
    brief["notes"] = notes[:MAX_NOTES]
    for dropped in notes[MAX_NOTES:]:
        print(f"note dropped: {dropped}", file=sys.stderr)

    errors = contract.validate(brief, fields)
    if errors:
        raise MergeError("\n".join(f"merge: {error}" for error in errors))
    return brief, writes, problems


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
    plan = contract.read_json(args.scratch / "plan.json")
    started = {name for wave in plan.values() if isinstance(wave, list) for name in wave} if isinstance(plan, dict) else None
    on_disk = sorted(path.stem for path in (args.scratch / "reviews").glob("*.json"))

    try:
        brief, writes, problems = merge(contract.read_json(args.scratch / "header.json"), parts, format_text, parts_text, new_reviews=on_disk, started=started)
    except MergeError as err:
        print(err, file=sys.stderr)
        return 1
    except Exception as err:  # never a bare traceback for the orchestrator to puzzle over
        print(f"merge: internal error: {type(err).__name__}: {err}", file=sys.stderr)
        return 1
    print("\n".join(problems), file=sys.stderr)
    for write in writes:
        write["file_path"] = str((args.scratch / write["file_path"]).resolve())
    (args.scratch / "brief.json").write_text(json.dumps(brief, indent=2, ensure_ascii=False) + "\n")
    (args.scratch / "writes.json").write_text(json.dumps(writes, indent=2) + "\n")
    print("\n".join(finish_lines(brief, parts, new_reviews=[w["doc_id"] for w in writes])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
