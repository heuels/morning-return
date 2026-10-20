#!/usr/bin/env python3
"""Write a `people` document for each teammate the brief names who needs one.

Usage:
  people_docs.py --scratch <dir> --existing <dir> --versions <file> --now <iso> [--brief <file>]
  people_docs.py --existing <dir> --now <iso> --list-fresh

A teammate needs a document when theirs is missing or more than 30 days old.
Names and photo links come from the Slack enrichment's `people_profiles`
hand-off. Photos are fetched only over https from Slack's and Gravatar's
image hosts, cropped square, scaled to 64×64 and stored as a JPEG data URI;
a photo that can't be fetched leaves `photo: null`.

--existing is where `ArtifactData` `list` saved the current documents
(<dir>/people/<email>.json); --versions maps each of their emails to the
version that listing showed, which every rewrite is pinned to. A document
without a known version is left as it is. The entries are added to
<scratch>/writes.json for the orchestrator's batch.

--list-fresh prints the emails whose documents are fresh, so the Slack
enrichment can skip looking them up.

This is the one script that uses the network.
"""

import argparse
import base64
import io
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import contract

HOSTS = {"avatars.slack-edge.com", "ca.slack-edge.com", "secure.gravatar.com"}
MAX_AGE = timedelta(days=30)
MAX_BYTES = 2_000_000
SAFE_ID = re.compile(r"^[A-Za-z0-9._~:@+-]{1,200}$")


def _when(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def teammate_emails(brief):
    """Every teammate email the page will look up, in the order it names them."""
    prs = [pr for key in contract.PR_LISTS for pr in brief.get(key) or []]
    items = [item for key in ("mail_asks", "slack_asks", "linear_asks", "slack_discussions") for item in brief.get(key) or []]
    emails = [e for pr in prs for e in [pr.get("author_email"), *(r.get("email") for r in pr.get("requested_reviewers") or [])]]
    emails += [a.get("email") for m in brief.get("meetings") or [] for a in m.get("attendees") or []]
    emails += [e for item in items for e in item.get("people") or []]
    emails += [o.get("email") for o in brief.get("out_of_office") or []]
    emails += [issue.get("by") for issue in (brief.get("linear") or {}).get("assigned") or []]
    team = (e.lower() for e in emails if isinstance(e, str))
    return list(dict.fromkeys(e for e in team if e.endswith("@" + contract.TEAM_DOMAIN) and SAFE_ID.match(e)))


def allowed(url):
    parsed = urlparse(url or "")
    return parsed.scheme == "https" and parsed.hostname in HOSTS


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only to another allowed image host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed(newurl):
            raise urllib.error.HTTPError(newurl, code, "redirect off the allowed image hosts", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(SafeRedirect)


def default_fetch(url):
    with _OPENER.open(url, timeout=5) as response:
        return response.read(MAX_BYTES)


def photo_uri(data):
    from PIL import Image

    image = Image.open(io.BytesIO(data)).convert("RGB")
    side = min(image.size)
    left, top = (image.width - side) // 2, (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((64, 64), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


def _photo(url, fetch):
    if not allowed(url):
        return None
    try:
        return photo_uri(fetch(url))
    except Exception:  # a photo is never worth failing the run over
        return None


def _due(existing_dir, email, now):
    current = contract.read_json(existing_dir / "people" / f"{email}.json")
    if not isinstance(current, dict):
        return True
    try:
        return _when(current["updated_at"]) < now - MAX_AGE
    except (KeyError, TypeError, ValueError):
        return True


def fresh(existing_dir, now):
    """Emails whose documents are recent enough to leave alone."""
    paths = sorted((existing_dir / "people").glob("*.json"))
    return [path.stem for path in paths if not _due(existing_dir, path.stem, _when(now))]


def write_people(scratch, brief, existing_dir, versions, now, fetch=default_fetch, unpinned=None):
    """The batch entries for the people documents written; emails left for lack of a version go in `unpinned`."""
    unpinned = [] if unpinned is None else unpinned
    enrich = contract.read_json(scratch / "parts" / "slack-enrich.json")
    handoffs = enrich.get("handoffs") if isinstance(enrich, dict) and isinstance(enrich.get("handoffs"), dict) else {}
    profiles = handoffs.get("people_profiles") if isinstance(handoffs.get("people_profiles"), dict) else {}
    exists = {path.stem for path in (existing_dir / "people").glob("*.json")}
    (scratch / "people").mkdir(exist_ok=True)
    writes = []
    for email in teammate_emails(brief):
        profile = profiles.get(email)
        if not isinstance(profile, dict) or not isinstance(profile.get("name"), str) or not _due(existing_dir, email, _when(now)):
            continue
        if email in exists and not isinstance(versions.get(email), int):
            unpinned.append(email)
            continue
        doc = {"name": profile["name"], "org": "Taxwire", "photo": _photo(profile.get("photo_url"), fetch), "updated_at": now}
        path = scratch / "people" / f"{email}.json"
        path.write_text(json.dumps(doc) + "\n")
        write = {"op": "set", "collection": "people", "doc_id": email, "file_path": str(path.resolve())}
        if email in exists:
            write["if_version"] = versions[email]
        writes.append(write)
    return writes


def main(argv=None, fetch=default_fetch):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scratch", type=Path)
    parser.add_argument("--existing", type=Path, required=True)
    parser.add_argument("--versions", type=Path)
    parser.add_argument("--now", required=True)
    parser.add_argument("--brief", type=Path)
    parser.add_argument("--list-fresh", action="store_true", help="print the emails whose documents are fresh, then exit")
    args = parser.parse_args(argv)
    if args.list_fresh:
        print("\n".join(fresh(args.existing, args.now)))
        return 0
    if not (args.scratch and args.versions):
        parser.error("--scratch and --versions are required to write documents")
    brief = contract.read_json(args.brief or args.scratch / "brief.json")
    brief = brief if isinstance(brief, dict) else {}
    versions = contract.read_json(args.versions)
    versions = versions if isinstance(versions, dict) else {}
    unpinned = []
    writes = write_people(args.scratch, brief, args.existing, versions, args.now, fetch, unpinned)
    all_writes = (contract.read_json(args.scratch / "writes.json") or []) + writes
    (args.scratch / "writes.json").write_text(json.dumps(all_writes, indent=2) + "\n")
    print(f"{len(writes)} people documents")
    if unpinned:
        print(f"{len(unpinned)} stale, left as they are: no version known for {', '.join(unpinned)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
