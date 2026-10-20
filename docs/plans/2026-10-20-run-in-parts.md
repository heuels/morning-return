# Run in Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each unit of the morning-return run runs in its own subagent and
writes a part file. Small Python scripts merge, validate and number the
results, and the orchestrator writes the database from files. That keeps the
raw Slack, GitHub and mail reads, and every review, out of the orchestrator's
context, and it never retypes a review or the brief.

**Architecture:** The orchestrator (`SKILL.md`) runs in four waves:

1. **Gather:** `github`, `sessions`, `comms` and `calendar` run in parallel.
2. **Follow-ups:** `linear` and `meeting-prep` run, while review subagents
   run at most 4 at a time.
3. **People:** `people` runs.
4. **Merge and write:** `merge_brief.py` joins the parts into
   `brief.json`, and one `ArtifactData` batch writes from `file_path`s.

`parts.md` says which part owns which brief fields. The scripts parse it and
`brief-format.md`, so the contract stays in one place.

**Tech Stack:** Claude Code skills and subagents. Python 3 standard library
only. The tests use `unittest`.

**Spec:** This implements steps 4 and 5 of the split review of 2026-10-20.
Steps 1–3 are done in `58f1371`: the lookup was fixed, the split was
mechanical, and the run is delivered from this repository. The contract is
`.claude/skills/morning-return-run/brief-format.md` and the rules are
`rules.md`. The review's recommendations that still apply are below as
Global Constraints.

## Global Constraints

- **The brief contract doesn't change.** `brief-format.md` stays the one
  contract. The scripts read it rather than copying field lists.
- **Only the orchestrator writes to the page's database.**
  - Subagents read, and write files only under the run's scratch directory:
    `parts/`, `reviews/` and `people/`.
  - Each subagent replies with one line: `done` or `failed: <why>`.
- **Scripts:**
  - Python 3, standard library only;
  - in `.claude/skills/morning-return-run/scripts/`;
  - deterministic, with no network;
  - exit 0 on success, 1 with one error per line on stderr.
- **A failing unit never stops the run.**
  - A missing or invalid part becomes `{"ok": false, "error": "<unit> didn't finish"}`
    for each source it owns, and its lists become `[]`.
  - The run's other rules stay in `rules.md` only. A test enforces that.
- **Reviews:** at most 8 per run and at most 4 at once. Never from
  `team_review_prs`. A review id is `<owner>:<repo>:<number>:<head_sha>`.
- **`--mode full` keeps working until the user drops it.** The full prompt
  carries the scripts for the run to write out.
- **Don't change the live Routine without the user's go-ahead.** That covers
  `update_trigger`, `fire_trigger` and its repositories.
- **`main` is what runs.** Work on a branch, and merge only after Task 6
  verifies it.

## Review Focus

1. **A subagent writes a field its part doesn't own, or a misspelt one**
   (`headSha`). The page would silently lose it. `merge_brief.py` rejects
   both (Task 2).
2. **A unit dies and leaves no part, or half-written JSON.** Its sources show
   as failed and the rest of the brief is written (Task 2).
3. **A Slack ping about a review PR comes from someone other than its
   author.** It must not set `blocking_signal` when the author's email is
   known (Task 2).
4. **A review's Summary differs slightly** from the template: there's a
   `(Total n)` suffix, extra spaces, or the Verdict is in capitals. It still
   parses. One with no Totals line is rejected and retried next run
   (Task 3).
5. **A teammate email isn't a valid document id** (for example, it contains
   `'`). One bad id would fail the whole atomic batch, so it is left out of
   the writes with a note (Task 2).

---

### Task 1: Who owns what, and the contract as data

**Files:**
- Create: `.claude/skills/morning-return-run/parts.md`,
  `.claude/skills/morning-return-run/scripts/contract.py`,
  `tests/test_contract.py`

**Interfaces:**
- Produces, in `contract.py`:
  - `brief_fields(text: str) -> dict[str, set[str]]`. It reads
    `brief-format.md` and returns its keys: `"brief"`, `"PR"`, `"Meeting"`,
    `"Item"` and `"Linear"`. Each maps to the set of backticked names in the
    first cell of that record's table. A cell like `` `number`, `title` ``
    gives both names.
  - `sources(text) -> set[str]`, read from the braces in the `sources` row.
  - `ownership(text: str) -> dict[str, dict]`. It reads `parts.md` and
    returns
    `{part: {"unit": str, "fields": set[str], "sources": set[str], "handoffs": set[str]}}`,
    with `"header"` for the orchestrator's own fields.
  - `validate(brief: dict, fields) -> list[str]`. Each error is
    `<path>: missing <name>` or `<path>: unknown <name>`. A path looks like
    `my_prs[2]` or `meetings[0].action`.
    - It checks the brief's top level, every PR in the three PR lists, every
      Meeting, every Item in `slack_asks`, `slack_discussions`, `mail_asks`
      and `linear_asks`, and `linear`'s keys.
    - It checks `sources`' keys too.
- `parts.md` holds one table. Its columns are Part file, Unit, Brief fields,
  Sources and Hand-offs. Its rows:

  | Part | Unit | Fields | Sources | Hand-offs |
  |---|---|---|---|---|
  | header | SKILL.md | `run_date`, `generated_at`, `since`, `login`, `environment`, `page_url`, `timezone`, `notes` | — | — |
  | `github.json` | github.md | `review_prs`, `team_review_prs`, `my_prs`, `stale_closed` | `github` | `repos` |
  | `sessions.json` | sessions.md | — | `sessions` | `branches` |
  | `comms.json` | comms.md | `slack_asks`, `slack_discussions`, `mail_asks` | `slack`, `gmail` | `pr_pings`, `invites` |
  | `calendar.json` | calendar.md | `day_blocks`, `out_of_office` | `calendar` | `events` |
  | `meetings.json` | meeting-prep.md | `meetings` | — | — |
  | `linear.json` | linear.md | `linear`, `linear_asks`, `linear_issues` | `linear` | — |
  | `reviews.json` | scripts | — | — | `review_ids`, `queued` |
  | `people.json` | people.md | — | — | `emails`, `people_docs` |

  Under the table, `parts.md` gives each hand-off's shape in one line:
  - `repos`: `[{repo, clone}]`, where `clone` is the clone URL `add_repo`
    gave.
  - `branches`: `[{repo, branch, finished}]`, one per repo and branch, from
    the most recently updated matching session.
  - `pr_pings`: `[{repo, number, from_email, from_name, line}]`.
  - `invites`: Meeting records for invites to events today.
  - `events`: Meeting records from my calendar, with `context` and `action`
    set to `null`.
  - `review_ids`: `{"owner/repo#number": id}`.
  - `queued`: a number.
  - `emails`: `{login: email | null}`.
  - `people_docs`: `[{email, file, version | null}]`.

  It also gives the part file's own shape:
  `{"sources": {...}, "fields": {...}, "notes": [...], "handoffs": {...}}`.

- [ ] **Step 1: Write the failing tests** in `tests/test_contract.py`.
  - `test_the_fixture_brief_meets_the_contract`: `validate` on
    `tests/fixtures/brief.json` returns `[]`. That ties the page's fixture to
    the contract.
  - `test_a_missing_pr_field_is_named_with_its_path`: delete
    `my_prs[1].head_sha`, and expect `"my_prs[1]: missing head_sha"`.
  - `test_an_unknown_field_is_named`: add `my_prs[0].headSha`, and expect
    `"my_prs[0]: unknown headSha"`.
  - `test_multi_name_cells_give_every_name`: `PR` contains `number`, `title`,
    `url` and `author`.
  - `test_every_brief_field_has_exactly_one_owner`: across `ownership(...)`,
    the union of the `fields` sets equals `brief_fields(...)["brief"]` minus
    `sources`, and no field appears twice.
  - `test_every_source_has_one_owner`: the same check over `sources`.
  - `test_every_unit_named_exists`: each `unit` is a file in the run
    directory.

- [ ] **Step 2: Run them to watch them fail.**
  `python3 -m unittest tests.test_contract -v` should fail with an import
  error.

- [ ] **Step 3: Write `parts.md` and implement `contract.py`.** If the
  fixture fails validation, fix the fixture or `brief-format.md`, whichever
  is wrong, and say which in the commit.

- [ ] **Step 4: Run the tests.** Then run the whole suite, and expect all to
  pass.

- [ ] **Step 5: Sabotage.**
  1. Drop `head_ref` from the PR table in `brief-format.md`; the fixture test
     must fail.
  2. Give `meetings` two owners in `parts.md`; the ownership test must fail.
  3. Restore both.

- [ ] **Step 6: Commit** with `feat(run): parts.md and the contract as data`.

### Task 2: Merging the parts

**Files:**
- Create: `.claude/skills/morning-return-run/scripts/merge_brief.py`,
  `tests/test_merge_brief.py`

**Interfaces:**
- Consumes: `contract.brief_fields`, `contract.ownership`,
  `contract.validate`.
- Produces:
  - The CLI is
    `merge_brief.py --run-dir <skill dir> --scratch <dir> [--skip <part> ...]`.
    It reads `<scratch>/header.json` and `<scratch>/parts/*.json`. It writes
    `<scratch>/brief.json` and `<scratch>/writes.json`, prints the run's
    three Finish lines to stdout, and exits 1 on validation errors.
  - `merge(header: dict, parts: dict[str, dict | None], text_format: str, text_parts: str) -> tuple[dict, list[dict], list[str]]`
    returns the brief, the batch writes and the errors.
    - A `None` part is missing or unreadable.
- Merge rules (each has its own test):
  1. **Missing or unreadable parts.** A part that is `None` gives each source
     it owns `{"ok": false, "error": "<unit> didn't finish"}`. Its list
     fields become `[]`. `linear` becomes
     `{"assigned": [], "project_updates": [], "stale": []}` and
     `linear_issues` becomes `{}`.
  2. **Unowned fields.** A field in a part's `fields` that `parts.md` doesn't
     give that part is an error: `<part>: doesn't own <field>`.
  3. **No meetings part.** If `meetings.json` is missing and `calendar` is
     ok, `meetings` is `calendar.events`.
  4. **Emails.** `emails` fill `author_email`, and `requested_reviewers[].email`
     where it is `null`, in all three PR lists.
  5. **Blocking signals.** Each `review_prs` entry takes the first `pr_pings`
     line with the same repo and number. The ping counts only when its
     `from_email` is the PR's `author_email`, or the author's email is
     unknown.
  6. **Review ids.** `review_ids["owner/repo#n"]` sets `review_id` on the PR
     in `review_prs` and `my_prs`.
  7. **Notes.** `notes` lists the header's notes first, then each part's in
     `parts.md` order. It keeps the first 4 and prints the rest to stderr.
  8. **Writes.** `writes.json` lists `{op: "set", collection, doc_id, file_path, if_version?}`.
     - It has one entry per `<scratch>/reviews/*.json` and one per
       `people_docs` entry.
     - It leaves out a doc id that doesn't match
       `^[A-Za-z0-9._~:@+-]{1,200}$`, and adds a note for it.
     - The brief is not in it; it is written last, on its own.
  9. **Finish lines.**
     1. The count in each brief list.
     2. `Reviews: <new> run, <already> already reviewed, <queued> queued`.
     3. The sources that failed, or `No source failed`.

- [ ] **Step 1: Write the failing tests** in `tests/test_merge_brief.py`.
  - A helper `split(brief)` cuts `tests/fixtures/brief.json` into a header
    and parts by `ownership`.
    - It puts `calendar.events` as the fixture's meetings with `context` and
      `action` set to `null`.
    - It puts the fixture's emails into `people.emails` and nulls them on the
      PRs.
    - It moves `blocking_signal` and `review_id` into `pr_pings` and
      `review_ids`.
  - `test_split_and_merged_back_is_the_fixture`: `merge(split(fixture))`
    gives back the fixture brief, with no errors.
  - `test_a_missing_part_fails_its_sources_and_empties_its_lists`: drop
    `comms`, and `slack` and `gmail` read as failed, and the three Item lists
    as `[]`.
  - `test_truncated_json_counts_as_missing`, through the CLI, on a
    half-written `comms.json`.
  - `test_a_field_the_part_doesnt_own_is_an_error`
  - `test_a_misspelt_field_is_an_error`: `my_prs[0].headSha`.
  - `test_without_meeting_prep_the_calendar_events_stand`
  - `test_a_ping_from_someone_else_isnt_blocking`
  - `test_a_ping_counts_when_the_author_is_unknown`
  - `test_notes_keep_the_first_four_header_first`
  - `test_a_bad_doc_id_is_left_out_of_the_writes_with_a_note`
  - `test_finish_lines`

- [ ] **Step 2: Run them to watch them fail.**

- [ ] **Step 3: Implement `merge_brief.py`.**

- [ ] **Step 4: Run all the tests.** Expect them all to pass.

- [ ] **Step 5: Sabotage.**
  1. Skip the ownership check; the unowned-field test must fail.
  2. Drop the author check on pings; the ping test must fail.
  3. Restore both.

- [ ] **Step 6: Commit** with `feat(run): merge_brief.py joins and checks the parts`.

### Task 3: Review queue and review documents

**Files:**
- Create: `.claude/skills/morning-return-run/scripts/review_queue.py`,
  `.claude/skills/morning-return-run/scripts/review_doc.py`,
  `tests/test_reviews.py`

**Interfaces:**
- Produces:
  - `review_queue.py ids --scratch <dir>` prints each candidate's review id,
    one per line, in reviews.md's order.
    - It reads `parts/github.json`, `parts/sessions.json` and
      `parts/comms.json`.
    - For ordering only, any ping on a review PR counts as a blocking
      signal.
    - It dedupes by id.
  - `review_queue.py pick --scratch <dir> --existing <file> --limit 8` prints
    JSON `{"run": [{id, repo, number, head_sha, head_ref, base_ref, clone}], "queued": n}`.
    It also writes `parts/reviews.json` with `review_ids` for the existing
    reviews and `queued`.
  - `review_doc.py --scratch <dir> --markdown <file> --id <id> --reviewed-at <iso>`
    writes `<scratch>/reviews/<id>.json` as brief-format.md's `reviews`
    record, and adds the id to `parts/reviews.json`.
    - Exit 1 when the Summary doesn't parse.
- Parsing:
  - Totals:
    `^- Totals: Critical (\d+), High (\d+), Medium (\d+), Low (\d+)`,
    case-insensitive, with any spaces, and any suffix allowed.
  - Verdict: `^- Verdict: (blocking|needs-work|minor|ship-ready)\b`,
    case-insensitive and stored in lower case.

- [ ] **Step 1: Write the failing tests** in `tests/test_reviews.py`.
  - `test_candidates_in_order`: review PRs with a ping come first, then the
    longest waiting, then the smallest. Then my non-draft PRs, then drafts
    whose branch is `finished`, oldest first. Never a team PR.
  - `test_existing_reviews_are_dropped_and_recorded`
  - `test_past_the_limit_is_queued`
  - `test_the_template_summary_parses`: use the Summary lines exactly as
    `review-prompt.md` prints them, with numbers filled in, including
    `(Total n)`.
  - `test_capitals_and_spaces_parse`
  - `test_no_totals_line_is_rejected_and_writes_nothing`
  - `test_markdown_is_kept_byte_for_byte`

- [ ] **Step 2: Run them to watch them fail.**

- [ ] **Step 3: Implement both scripts.**

- [ ] **Step 4: Run all the tests.** Expect them all to pass.

- [ ] **Step 5: Sabotage.**
  1. Make the Verdict regex case-sensitive; the capitals test must fail.
  2. Restore.

- [ ] **Step 6: Commit** with `feat(run): scripts for the review queue and review documents`.

### Task 4: Units write parts; the orchestrator runs waves

**Files:**
- Create: `.claude/skills/morning-return-run/sessions.md`. Move the
  "Claude sessions" section out of `SKILL.md` into it.
- Modify: `SKILL.md`, `github.md`, `comms.md`, `calendar.md`,
  `meeting-prep.md`, `linear.md`, `people.md`, `reviews.md` (all in the run
  directory); `.claude/skills/morning-return-setup/assemble_prompt.py`;
  `tests/test_assemble_prompt.py`; `README.md`; `CLAUDE.md`

**Interfaces:**
- Consumes: the Task 1–3 scripts and `parts.md`.
- Produces:
  - **Each unit** ends with an `## Output` section of two or three lines. It
    names its part file, says to write it as `parts.md` describes, and lists
    which earlier parts it may read:
    - `meeting-prep` reads `calendar` and `comms`;
    - `linear` reads `github`;
    - `people` reads every part.
  - **`reviews.md`**: the review subagent writes its markdown to
    `<scratch>/reviews/<repo>-<number>.md`, and that is the only file it
    writes. Then the orchestrator runs `review_doc.py`.
  - **`SKILL.md`** steps:
    1. Dates and this session: write `header.json`, and `get` today's brief
       for its version.
    2. Wave 1: four subagents.
    3. Wave 2:
       - `review_queue.py ids`, then `get` each id;
       - write `existing.txt`;
       - `pick`;
       - clones and worktrees, with Bash, by the orchestrator;
       - `linear`, `meeting-prep` and the review subagents, 4 at a time.
    4. Wave 3: `people`.
    5. Merge: on errors, run the named part's unit once more with the error
       lines, then merge again. If it fails again, rerun with
       `--skip <part>`.
    6. Write: `batch` the entries of `writes.json` (at most 50 per call),
       then `set` the brief from `brief.json`, with `if_version` when it
       exists.
    7. Finish: print `merge_brief.py`'s three lines.
  - **The subagent prompt**, given once in SKILL.md and filled per unit:
    `Read <dir>/rules.md, <dir>/brief-format.md and <dir>/parts.md, then follow <dir>/<unit>.md. Page: …; GitHub login: …; Timezone: …; run_date: …; window start: …; scratch: <scratch>. Reply with one line: done, or failed: <why>.`
  - **`assemble_prompt.py`**: `ORDER` gains `sessions.md` and `parts.md`.
    `--mode full` appends each `scripts/*.py` as
    `# File: scripts/<name>` with a fenced block, and SKILL.md's full-mode
    header tells the run to write them out to `<scratch>/scripts/` first.

- [ ] **Step 1: Write the failing tests** in `tests/test_assemble_prompt.py`.
  - `test_full_carries_every_script_verbatim`
  - `test_every_script_the_orchestrator_names_exists`: every
    `scripts/<name>.py` that SKILL.md names exists.
  - `test_every_unit_has_an_output_section_naming_its_part`: from `ownership`.
  - Update `test_the_order_covers_every_run_file` for the new files.

- [ ] **Step 2: Run them to watch them fail.**

- [ ] **Step 3: Edit the units and SKILL.md, and extend the assembler.**
  Keep the rules out of these files; `test_only_rules_md_states_the_rules`
  checks that.

- [ ] **Step 4: Dry-run the scripts end to end.**
  1. Create a scratch directory and put `header.json` and the `split()`
     parts from Task 2 in it.
  2. Run `review_queue.py ids`, then `pick --existing /dev/null`, then
     `review_doc.py` on a sample review.
  3. Run `merge_brief.py`.

  Expected: `brief.json` passes `validate`, `writes.json` holds the review,
  and the three Finish lines print.

- [ ] **Step 5: Run all the tests.** Expect them all to pass.

- [ ] **Step 6: Commit** with `feat(run): units write parts; the orchestrator runs them in waves`.

### Task 5: Agent definitions with tool allowlists (behind a spike)

**Files:**
- Create: `.claude/agents/mr-github.md`, `mr-sessions.md`, `mr-comms.md`,
  `mr-calendar.md`, `mr-meeting-prep.md`, `mr-linear.md`, `mr-people.md` and
  `mr-review.md` (all in `.claude/agents/`), plus
  `docs/routine-environment.md`
- Modify: `SKILL.md` (the dispatch uses `mr-<unit>`, falling back to
  `general-purpose`), `CLAUDE.md`

- [ ] **Step 1: Spike** (no code). Get the user's go-ahead for a throwaway
  `create_session` with `source_url: https://github.com/heuels/morning-return`
  on this branch, in the Taxwire environment, with a `.claude/agents/mr-probe.md`
  committed. Its `tools:` should list one Slack read tool and Read. Ask it to
  reply with three things:
  1. the subagent types its Agent tool offers;
  2. the exact names of its tools whose names contain `slack`, `gmail`,
     `calendar`, `drive`, `linear`, `github`, `ArtifactData`,
     `list_sessions` or `list_environments`;
  3. whether `mr-probe` can call its Slack tool through `ToolSearch`.

  Record the answers in `docs/routine-environment.md`. If there is a later
  Routine run with the repository attached, check the same things from its
  events (`list_events`).

- [ ] **Step 2: Decide.**
  - **If `mr-probe` was offered and could call its tool:** write the eight
    agent files. Each `tools:` lists exactly what its unit's file names, plus
    `Read`, `Grep`, `Glob`, `Bash` (only the reviews and people units, which
    need git and Pillow), `Write` and `ToolSearch`.
    `mr-review` gets `Read`, `Grep`, `Glob`, `Bash`, `Write`, and
    `pull_request_read` and `get_file_contents` for the diff-only fallback.
  - **If not:** don't add the agents. Note in `docs/routine-environment.md`
    why, and that `rules.md` is the only guard.
  - Either way, delete `mr-probe.md`.

- [ ] **Step 3: Test.** `tests/test_agents.py` gets
  `test_every_tool_an_agent_lists_is_one_the_spike_saw`: it parses each
  agent's `tools:` and checks the names against the list in
  `docs/routine-environment.md`. It also gets
  `test_every_unit_has_an_agent`. Only write these when the agents are kept.

- [ ] **Step 4: Run all the tests, then sabotage.**
  1. Misspell one tool; the first test must fail.
  2. Restore.

- [ ] **Step 5: Commit** with `feat(run): subagents with tool allowlists`.

### Task 6: Go live

- [ ] **Step 1:** Run the code review skill on the branch against `main`, and
  fix what it confirms.

- [ ] **Step 2: Merge the branch to `main`.** From now on the next run uses
  it. A Routine on the full prompt only gets it when setup steps 4–5 run.

- [ ] **Step 3: With the user.**
  1. They attach `heuels/morning-return` to the Morning brief Routine on the
     claude.ai Routines page.
  2. On their go-ahead, `update_trigger` the stub prompt (setup step 5), and
     `fire_trigger` once.

- [ ] **Step 4: Verify** with setup's Verify section. Also check these:
  - The run's main thread holds no review markdown: `list_events` on the run
    shows `review_doc.py` calls, not long `ArtifactData` payloads.
  - Every source is `ok`, or failed with its error line.
  - The duration is no worse than the last single-thread run.

- [ ] **Step 5:** Tell the user the outcome. Propose removing `--mode full`
  two weeks after a clean run, as a separate change.
