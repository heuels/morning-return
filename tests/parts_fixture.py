"""Realistic run parts, cut from the page's fixture brief.

split(brief) returns the header and the part files the passes would have
written for that brief, so merge_brief.merge(*split(brief)) gives it back.
"""

import copy
import json
from pathlib import Path

FIXTURE = json.loads((Path(__file__).resolve().parent / "fixtures" / "brief.json").read_text())
HEADER_FIELDS = ("run_date", "generated_at", "since", "login", "environment", "page_url", "timezone")
PR_LISTS = ("review_prs", "team_review_prs", "my_prs")
REVIEW_ID = "taxwire:example-api:101:0000000000000000000000000000000000000101"


def part(fields=None, sources=None, handoffs=None, notes=None):
    return {"sources": sources or {}, "fields": fields or {}, "notes": notes or [], "handoffs": handoffs or {}}


def split(brief):
    """Cut a whole brief into the header and parts the passes would write."""
    b = copy.deepcopy(brief)
    header = {key: b[key] for key in HEADER_FIELDS} | {"notes": []}

    identities = {}
    for key in PR_LISTS:
        for pr in b[key]:
            if pr["author_email"]:
                identities[pr["author"]] = [{"name": "Ben Ortiz", "email": pr["author_email"]}]
            pr["author_email"] = None
            pr["review_id"] = None
            for reviewer in pr["requested_reviewers"]:
                identities[reviewer["login"]] = [{"name": "Ben Ortiz", "email": reviewer["email"]}]
                reviewer["email"] = None
    pr_keys = [
        {"key": f"{pr['repo']}#{pr['number']}", "url": pr["url"], "title": pr["title"], "head_ref": pr["head_ref"], "author": pr["author"]}
        for key in PR_LISTS
        for pr in b[key]
    ]
    github = part(
        fields={key: b[key] for key in (*PR_LISTS, "stale_closed")},
        sources={"github": b["sources"]["github"]},
        handoffs={"pr_keys": pr_keys, "commit_identities": identities},
    )

    senders = {}
    for item in b["mail_asks"]:
        senders[item["url"]] = "dana@acme.example"
        item["tag"] = None
        if item["action"]:
            item["action"]["by"] = None
    events = [m | {"context": None, "action": None} for m in b["meetings"] if m["on_calendar"]]
    invites = [m | {"context": None, "action": None} for m in b["meetings"] if not m["on_calendar"]]
    meeting_keys = [
        {
            "key": m["url"],
            "title": m["title"],
            "start": m["start"],
            "attendees": [a["email"] for a in m["attendees"]],
            "external_domains": sorted({a["email"].split("@")[1] for a in m["attendees"] if a["org"] != "Taxwire"}),
            "recurring": m["kind"] == "internal",
        }
        for m in events
    ]
    ooo_names = [entry["name"] for entry in b["out_of_office"]]
    names = {entry["name"]: entry["email"] for entry in b["out_of_office"]}
    for entry in b["out_of_office"]:
        entry["email"] = None

    open_urls = {pr["url"] for key in PR_LISTS for pr in b[key]}
    issues, pr_states = {}, {}
    for identifier, issue in b["linear_issues"].items():
        issues[identifier] = {key: issue[key] for key in ("title", "url", "status")} | {"pr_urls": [pr["url"] for pr in issue["prs"]]}
        for pr in issue["prs"]:
            if pr["url"] not in open_urls:
                pr_states[pr["url"]] = pr["state"]

    reviewed = {f"{pr['repo']}#{pr['number']}": pr["review_id"] for key in PR_LISTS for pr in brief[key] if pr["review_id"]}
    parts = {
        "github": github,
        "sessions": part(sources={"sessions": b["sources"]["sessions"]}, handoffs={"branches": []}),
        "slack": part(
            fields={"slack_asks": b["slack_asks"], "slack_discussions": b["slack_discussions"]},
            sources={"slack": b["sources"]["slack"]},
            handoffs={"pr_links": [], "ask_senders": {}, "seen": []},
        ),
        "gmail": part(fields={"mail_asks": b["mail_asks"]}, sources={"gmail": b["sources"]["gmail"]}, handoffs={"invites": invites, "senders": senders}),
        "calendar": part(
            fields={"day_blocks": b["day_blocks"], "out_of_office": b["out_of_office"]},
            sources={"calendar": b["sources"]["calendar"]},
            handoffs={"events": events, "meeting_keys": meeting_keys, "ooo_names": ooo_names},
        ),
        "linear": part(fields={"linear": b["linear"], "linear_asks": b["linear_asks"]}, sources={"linear": b["sources"]["linear"]}, handoffs={"linear_names": []}),
        "slack-enrich": part(handoffs={"pr_mentions": [], "meeting_threads": {}, "names": names, "people_profiles": {}}),
        "gmail-enrich": part(handoffs={"meeting_threads": {}}),
        "linear-enrich": part(handoffs={"issues": issues}),
        "meetings": part(fields={"meetings": b["meetings"]}),
        "github-enrich": part(handoffs={"pr_states": pr_states}),
        "reviews": part(handoffs={"review_ids": reviewed, "queued": 2, "prompt": "live"}),
    }
    return header, parts
