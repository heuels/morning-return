# Morning return

Egor's weekday morning brief: one private claude.ai page that shows what needs
him this morning. It ranks the PRs to review, fix and merge (with first-pass
reviews), today's meetings with context, replies owed in Gmail, Slack and
Linear, and Slack threads worth knowing.

A claude.ai Routine, **Morning brief**, runs every weekday morning. It loads
the `morning-return-run` skill from this repository and runs it in passes:
one per source to gather, one per source to follow up on what the others
found, meeting prep and `/pr-review` reviews, each in its own subagent with
only its own source's tools. Scripts join their results into the brief and
write it into the page's database. The page only reads that database.

## Layout

| Path | What it is |
|---|---|
| `.claude/skills/morning-return-run/` | The run. `SKILL.md` is the orchestrator; `rules.md` holds the rules every pass follows; `parts.md` lists every pass (its wave, the one source whose tools it holds, its model and effort, what it reads and what it owns); one unit file per pass (`github.md`, `slack.md`, `slack-enrich.md`, `meeting-prep.md` and so on); `brief-format.md` is the contract with the page; `scripts/` joins, checks and writes the passes' results; `review-prompt.md` is the saved copy of `/pr-review`'s prompt, used when the live one can't be. |
| `.claude/skills/morning-return-setup/` | Setting up, updating and checking the page and the Routine, and `assemble_prompt.py`, which builds the Routine's prompt. |
| `page/` | The Artifact page: plain ES modules, no build step. `render.js` builds the page from a brief, `ui.js` holds the shared components, `rank.js` decides what to do about each PR. |
| `tests/` | Page tests (Node's test runner with Playwright) and assembler tests (Python `unittest`). |
| `docs/` | Product context, the original design and plan. |

## Tests

```bash
NODE_PATH=$(npm root -g) node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

The page tests need Playwright and Chromium, installed globally.

## Changing it

- **The run** goes live on the next morning after it reaches `main`.
- **The page** changes when it is published again (setup step 3).
- **A brief field** changes in five places together: `brief-format.md`, its
  owner in `parts.md`, the unit file that fills it, the page, and
  `tests/fixtures/brief.json`.
