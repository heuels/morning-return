"""The run's contracts as data.

brief-format.md says what the page reads; parts.md says which pass owns
which part of it. Both are read from their markdown tables here, so neither
is ever copied into code.
"""

import json
import re
from typing import NamedTuple

MODELS = {"haiku", "sonnet", "opus", "fable"}
EFFORTS = {"low", "medium", "high", "xhigh", "max"}

# brief-format.md: the record each table defines, found by the line before it.
RECORDS = {
    "brief": "### `briefs/<run_date>`",
    "Meeting": "**Meeting**",
    "PR": "**PR**",
    "Item": "**Item**",
    "Linear": "**Linear**",
}
PR_LISTS = ("review_prs", "team_review_prs", "my_prs")
ITEM_LISTS = ("slack_asks", "slack_discussions", "mail_asks", "linear_asks")

NAME = re.compile(r"`([A-Za-z_][\w-]*)`")
NONE = {"", "—", "-"}


class Part(NamedTuple):
    unit: str
    wave: int | None
    tools: str | None
    model: str | None
    effort: str | None
    reads: set[str]
    fields: set[str]
    sources: set[str]
    handoffs: set[str]


class Reviewer(NamedTuple):
    unit: str
    tools: str
    model: str
    effort: str


def _rows(text: str, marker: str) -> list[list[str]]:
    """The body rows of the first table after the line starting with `marker`."""
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith(marker)), None)
    if start is None:
        raise ValueError(f"no {marker!r} in the contract")
    table = []
    for line in lines[start + 1 :]:
        if line.startswith("|"):
            table.append(line)
        elif table:
            break
    return [[cell.strip() for cell in line.strip().strip("|").split("|")] for line in table[2:]]


def _names(cell: str) -> set[str]:
    return set(NAME.findall(cell))


def _plain(cell: str) -> str | None:
    cell = cell.strip("`")
    return None if cell in NONE else cell


def _list(cell: str) -> set[str]:
    return set() if cell in NONE else {name.strip().strip("`").removesuffix(".json") for name in cell.split(",")}


def sources(text: str) -> set[str]:
    row = next(row for row in _rows(text, RECORDS["brief"]) if row[0] == "`sources`")
    braces = re.search(r"\{([^}]*)\}", row[1])
    return {name.strip() for name in braces[1].split(",")}


def brief_fields(text: str) -> dict[str, set[str]]:
    """Each record's field names, plus the Action record and the source names."""
    fields = {record: set().union(*(_names(row[0]) for row in _rows(text, marker))) for record, marker in RECORDS.items()}
    action = re.search(r"\*\*Action\*\* — `\{([^}]*)\}`", text)
    fields["Action"] = {name.strip() for name in action[1].split(",")}
    fields["sources"] = sources(text)
    return fields


def ownership(text: str) -> dict[str, Part]:
    parts = {}
    for row in _rows(text, "## Passes"):
        name, unit, wave, tools, model, effort, reads, owned, owned_sources, handoffs = row
        parts[name.strip("`").removesuffix(".json")] = Part(
            unit=unit,
            wave=None if wave in NONE else int(wave),
            tools=_plain(tools),
            model=_plain(model),
            effort=_plain(effort),
            reads=_list(reads),
            fields=_names(owned),
            sources=_names(owned_sources),
            handoffs=_names(handoffs),
        )
    return parts


def reviewers(text: str) -> Reviewer:
    (row,) = _rows(text, "## Reviews")
    return Reviewer(unit=row[1], tools=row[2], model=row[3], effort=row[4])


def handoff_shapes(text: str) -> dict[str, str]:
    section = text.split("## Hand-offs", 1)[1].split("\n## ", 1)[0]
    return {m[1]: m[2].strip() for m in re.finditer(r"^- `([\w-]+)`: (.+)$", section, re.MULTILINE)}


def tools_by_source(text: str) -> dict[str, set[str]]:
    return {row[0]: _names(row[1]) for row in _rows(text, "## Tools")}


def _keys(path: str, value, allowed: set[str]) -> list[str]:
    if not isinstance(value, dict):
        return [f"{path}: not an object"]
    missing = [f"{path}: missing {name}" for name in sorted(allowed - value.keys())]
    unknown = [f"{path}: unknown {name}" for name in sorted(value.keys() - allowed)]
    return missing + unknown


def _records(brief: dict, key: str, allowed: set[str], action: set[str]) -> list[str]:
    value = brief.get(key)
    if not isinstance(value, list):
        return [] if value is None else [f"{key}: not a list"]
    errors = []
    for i, record in enumerate(value):
        errors += _keys(f"{key}[{i}]", record, allowed)
        if isinstance(record, dict) and isinstance(record.get("action"), dict):
            errors += _keys(f"{key}[{i}].action", record["action"], action)
    return errors


def _source_errors(value) -> list[str]:
    if not isinstance(value, dict):
        return []
    errors = []
    for name, entry in value.items():
        if not isinstance(entry, dict) or not isinstance(entry.get("ok"), bool):
            errors.append(f"sources.{name}: not {{ok, error}}")
        elif not entry["ok"] and not isinstance(entry.get("error"), str):
            errors.append(f"sources.{name}: failed without an error line")
    return errors


def validate(brief: dict, fields: dict[str, set[str]]) -> list[str]:
    """Every way `brief` differs from the contract, as `<path>: <problem>` lines."""
    errors = _keys("brief", brief, fields["brief"])
    errors += _keys("sources", brief.get("sources"), fields["sources"]) if "sources" in brief else []
    errors += _source_errors(brief.get("sources"))
    for key in PR_LISTS:
        errors += _records(brief, key, fields["PR"], fields["Action"])
    errors += _records(brief, "meetings", fields["Meeting"], fields["Action"])
    for key in ITEM_LISTS:
        errors += _records(brief, key, fields["Item"], fields["Action"])
    if isinstance(brief.get("linear"), dict):
        errors += _keys("linear", brief["linear"], fields["Linear"])
    return errors


# Shared by the scripts that read the run's scratch directory.
REVIEW_LIMIT = 8
TEAM_DOMAIN = "taxwire.com"


def read_json(path):
    """A file's JSON, or None when it is missing or doesn't parse."""
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def read_parts(scratch, names):
    return {name: read_json(scratch / "parts" / f"{name}.json") for name in names}
