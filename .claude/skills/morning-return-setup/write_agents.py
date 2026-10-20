#!/usr/bin/env python3
"""Write the run's agents, .claude/agents/mr-*.md, from the run's parts.md.

Each pass in parts.md gets an agent named mr-<part> that holds only its
source's read tools and runs on the pass's model and effort; the reviewer
gets mr-review. Run this after changing parts.md; a test fails until the
files match.
"""

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUN_DIR = REPO / ".claude" / "skills" / "morning-return-run"
AGENTS = REPO / ".claude" / "agents"
sys.path.insert(0, str(RUN_DIR / "scripts"))

import contract

COMMON = ["Read", "Grep", "Glob", "Write"]

PASS = """---
name: mr-{name}
description: The morning-return run's {name} pass ({unit}). Started only by the morning-return-run orchestrator.
tools: {tools}
model: {model}
effort: {effort}
---

You are one pass of the morning-return run: the `{name}` pass, which follows
`{unit}`. The prompt you are given names the run's directory, the values to
use and where to write your part. Read the run's `rules.md` first: it binds
you.
"""

REVIEW = """---
name: mr-review
description: A first-pass /pr-review review of one pull request for the morning-return run. Started only by the morning-return-run orchestrator.
tools: {tools}
model: {model}
effort: {effort}
---

You review one pull request for the morning-return run. The prompt you are
given says where its code is, the review prompt to follow, and the one file
to write.
"""


def render(parts_text):
    """{file name: contents} for every agent parts.md defines."""
    tools = contract.tools_by_source(parts_text)
    agents = {}
    for name, part in contract.ownership(parts_text).items():
        if part.tools:
            listed = ", ".join(COMMON + tools[part.tools])
            agents[f"mr-{name}.md"] = PASS.format(name=name, unit=part.unit, tools=listed, model=part.model, effort=part.effort)
    review = contract.reviewers(parts_text)
    listed = ", ".join(COMMON + ["Bash"] + tools[review.tools])
    agents["mr-review.md"] = REVIEW.format(tools=listed, model=review.model, effort=review.effort)
    return agents


def main():
    agents = render((RUN_DIR / "parts.md").read_text())
    AGENTS.mkdir(parents=True, exist_ok=True)
    for stale in AGENTS.glob("mr-*.md"):
        if stale.name not in agents:
            stale.unlink()
    for name, text in agents.items():
        (AGENTS / name).write_text(text)
    print(f"wrote {len(agents)} agents to {AGENTS.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
