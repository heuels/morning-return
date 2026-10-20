"""Read the passes' part files as the contract says they should be.

Part files are written by language models, so anything can be off: a list
written as null, a missing key, a field the part doesn't own, a hand-off of
the wrong type. Nothing here raises on such input. A record the page couldn't
use is left out, a key the contract doesn't name is dropped, a nullable field
that's missing becomes null, and every change is reported as a problem line
naming the part, so the orchestrator can rerun that pass once.
"""

from datetime import datetime

import contract

PART_KEYS = {"sources", "fields", "notes", "handoffs"}

# The fields each kind of record can't do without; every other field the
# contract names may be missing and becomes null (or [] for the list fields).
REQUIRED = {
    "PR": {"repo", "number", "title", "url", "author", "head_sha", "created_at"},
    "Item": {"title"},
    "Meeting": {"title", "start", "end"},
}
LIST_KEYS = {"requested_reviewers", "people", "attendees"}
DEFAULTS = {"stale": False, "draft": False, "on_calendar": True}
KIND_OF = {key: "PR" for key in contract.PR_LISTS} | {key: "Item" for key in contract.ITEM_LISTS} | {"meetings": "Meeting"}

# Records without a table of their own in brief-format.md: their keys, and
# the ones that may be null.
SIMPLE = {
    "stale_closed": ({"repo", "number", "title", "url", "closed_at"}, set()),
    "day_blocks": ({"kind", "start", "end"}, set()),
    "out_of_office": ({"email", "name", "start", "end"}, {"email"}),
}


def parse_time(value, zone):
    """An aware datetime for an ISO time, the zone filling in a missing offset; None if it isn't one."""
    if not isinstance(value, str) or "T" not in value:
        return None
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=zone)


def _action(value, fields):
    if not isinstance(value, dict) or not isinstance(value.get("verb"), str):
        return None
    return {key: value.get(key) if isinstance(value.get(key), str) else None for key in fields["Action"]}


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return int(value) if isinstance(value, str) and value.isdigit() else None


def clean_record(value, kind, fields, zone):
    """(record, None) with the contract's keys, or (None, why it can't be used)."""
    if not isinstance(value, dict):
        return None, "not an object"
    missing = sorted(key for key in REQUIRED[kind] if value.get(key) is None)
    if missing:
        return None, f"missing {', '.join(missing)}"
    record = {key: value.get(key, DEFAULTS.get(key)) for key in fields[kind]}
    for key in LIST_KEYS & record.keys():
        record[key] = [entry for entry in record[key] if isinstance(entry, (dict, str))] if isinstance(record[key], list) else []
    if "action" in record:
        record["action"] = _action(record["action"], fields)
    if kind == "PR":
        record["number"] = _number(record["number"])
        if record["number"] is None or "/" not in str(record["repo"]):
            return None, "no repo or number"
        record["requested_reviewers"] = [r for r in record["requested_reviewers"] if isinstance(r, dict) and r.get("login")]
    if kind == "Meeting":
        if parse_time(record["start"], zone) is None or parse_time(record["end"], zone) is None:
            return None, "no start or end time"
        record["attendees"] = [a for a in record["attendees"] if isinstance(a, dict) and isinstance(a.get("email"), str)]
    return record, None


def _simple(value, keys, nullable):
    if not isinstance(value, dict) or any(value.get(key) is None for key in keys - nullable):
        return None
    return {key: value.get(key) for key in keys}


def _list_field(name, field, value, fields, zone, problems):
    """The field's records the page can use, and how many were left out."""
    if value is None:
        return [], 0
    if not isinstance(value, list):
        problems.append(f"{name}: {field} isn't a list")
        return [], 1
    kept, dropped = [], 0
    for i, entry in enumerate(value):
        if field in SIMPLE:
            record, why = _simple(entry, *SIMPLE[field]), "not a whole entry"
        else:
            record, why = clean_record(entry, KIND_OF[field], fields, zone)
        if record is None:
            problems.append(f"{name}: {field}[{i}]: {why}")
            dropped += 1
        else:
            kept.append(record)
    return kept, dropped


def _linear(name, value, fields, problems):
    value = value if isinstance(value, dict) else {}
    if not value:
        problems.append(f"{name}: linear isn't an object")
    return {key: [e for e in value.get(key) or [] if isinstance(e, dict)] for key in fields["Linear"]}


def clean_field(name, field, value, fields, zone, problems):
    """(value, records left out) for one owned brief field."""
    if field == "linear":
        return _linear(name, value, fields, problems), 0
    if field in KIND_OF or field in SIMPLE:
        return _list_field(name, field, value, fields, zone, problems)
    return value, 0


def empty(field, fields):
    if field == "linear":
        return {key: [] for key in fields["Linear"]}
    return {} if field == "linear_issues" else []


def handoff_type(shape):
    """The JSON type a hand-off's shape in parts.md describes."""
    text = shape.lstrip("`")
    if text.startswith("[") or shape.startswith(("Meetings", "Items")):
        return list
    if text.startswith("{"):
        return dict
    return int if "number" in shape else str


def _source(value, unit):
    if isinstance(value, dict) and isinstance(value.get("ok"), str) and value["ok"].lower() in {"true", "false"}:
        value = value | {"ok": value["ok"].lower() == "true"}
    if not isinstance(value, dict) or not isinstance(value.get("ok"), bool):
        return {"ok": False, "error": f"{unit} wrote no readable status"}
    if value["ok"]:
        return {"ok": True}
    return {"ok": False, "error": str(value.get("error") or f"{unit} failed")}


def _sentence(text):
    text = str(text).strip()
    return text if text.endswith((".", "!", "?")) else text + "."


def clean_part(name, value, owner, fields, shapes, zone, problems):
    """The part as the contract has it, plus how many records were left out; None if nothing in it is usable."""
    if not isinstance(value, dict):
        problems.append(f"{name}: not a part object")
        return None
    problems += [f"{name}: unknown key {key}" for key in sorted(value.keys() - PART_KEYS)]

    raw_fields = value.get("fields") if isinstance(value.get("fields"), dict) else {}
    if not isinstance(value.get("fields"), (dict, type(None))):
        problems.append(f"{name}: fields isn't an object")
    problems += [f"{name}: doesn't own {key}" for key in sorted(raw_fields.keys() - owner.fields)]
    cleaned, dropped = {}, 0
    for field in sorted(owner.fields):
        if field not in raw_fields:
            problems.append(f"{name}: missing {field}")
            cleaned[field] = empty(field, fields)
        else:
            cleaned[field], lost = clean_field(name, field, raw_fields[field], fields, zone, problems)
            dropped += lost

    notes = value.get("notes")
    notes = [notes] if isinstance(notes, str) else [n for n in notes or [] if isinstance(n, str)] if isinstance(notes, list) else []

    raw_sources = value.get("sources") if isinstance(value.get("sources"), dict) else {}
    sources = {}
    for source, entry in raw_sources.items():
        if source in owner.sources:
            sources[source] = _source(entry, owner.unit)
        elif isinstance(entry, dict) and entry.get("ok") is False and entry.get("error"):
            notes.append(_sentence(entry["error"]))
        else:
            problems.append(f"{name}: doesn't own source {source}")
    for source in owner.sources - sources.keys():
        problems.append(f"{name}: missing source {source}")
        sources[source] = {"ok": True}

    raw_handoffs = value.get("handoffs") if isinstance(value.get("handoffs"), dict) else {}
    if not isinstance(value.get("handoffs"), (dict, type(None))):
        problems.append(f"{name}: handoffs isn't an object")
    handoffs = {}
    for key, item in raw_handoffs.items():
        if key not in owner.handoffs:
            problems.append(f"{name}: doesn't declare {key}")
        elif not isinstance(item, handoff_type(shapes[key])) or isinstance(item, bool):
            problems.append(f"{name}: {key} isn't a {handoff_type(shapes[key]).__name__}")
        else:
            handoffs[key] = item
    return {"sources": sources, "fields": cleaned, "notes": notes, "handoffs": handoffs, "dropped": dropped}
