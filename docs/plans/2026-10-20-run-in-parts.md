# Run in Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The morning-return run moves from one context to passes that run
in subagents. Each pass holds one source's tools, takes other passes' output
as files, and writes its own part file. Scripts merge the parts, validate the
result and write the database from files. Raw reads and reviews stay out of
the orchestrator's context, and no agent can be steered by a message from a
source whose tools it doesn't hold.

**Architecture:** Every source gets at most two passes.

- A **base** pass answers what that source can answer alone.
- An **enrichment** pass takes the other sources' base parts as input and
  answers the cross-source questions, still with only its own source's tools.

The passes run as waves over a dependency graph:

1. **Base:** github, sessions, slack, gmail, calendar and linear, in parallel.
2. **Enrich:** slack, gmail and linear, alongside reviews 1–4.
3. **Last:** the Drive-only meeting synthesiser and a small GitHub
   enrichment, alongside reviews 5–8.

Between the waves, the orchestrator runs only scripts. `merge_brief.py` is
the only thing that turns a hand-off into a brief field. `parts.md` declares
every part: its wave, tools, model, effort, what it reads, and what it owns.
Tests keep that graph acyclic and the contract in one place.

**Tech Stack:** Claude Code skills and subagents (the Agent tool; agent
definitions if Routine sessions load them). Python 3 standard library for the
scripts, plus Pillow in `people_docs.py`. The tests use `unittest`.

**Spec:**
- Steps 4–5 of the split review of 2026-10-20. Steps 1–3 are done in
  `58f1371`.
- The pipeline review of 2026-10-20 (per-source passes; its recommendations
  are the Architecture above and the Global Constraints below).
- The model and effort choices agreed the same day: the Model and Effort
  columns in Task 1.
- The contract is `.claude/skills/morning-return-run/brief-format.md`, and
  the rules are `rules.md`.

## Global Constraints

**The contract**
- `brief-format.md` doesn't change, and the page doesn't change.
- The scripts read the contract, not copies of its field lists.

**Passes and parts**
- **At most two passes per source**, base then enrichment.
- An enrichment reads only parts from earlier waves.
- An enrichment owns no brief field and no `sources` entry.
- Every brief field has exactly one owner: a base part, the Drive
  synthesiser (`meetings`), `header`, or `merge` for derived fields.

**One source per subagent**
- A subagent holds exactly one source's read tools, plus `Read`, `Grep`,
  `Glob`, `Write` and `ToolSearch`. Review subagents also get `Bash`.
- It writes files only under the run's scratch directory: `parts/` and
  `reviews/`.
- Only the orchestrator writes to the page's database.
- A subagent replies with one line: `done` or `failed: <why>`.

**Models and effort**
- They are set per pass in `parts.md` (Task 1's table). The orchestrator
  runs on the Routine's model.

**Scripts**
- Python 3, in `.claude/skills/morning-return-run/scripts/`.
- Deterministic, and no network. The one exception is `people_docs.py`,
  which fetches only from `avatars.slack-edge.com`, `ca.slack-edge.com` and
  `secure.gravatar.com` (Slack serves profile photos from all three).
- Exit 0 on success, 1 with one error per line on stderr.

**Failures**
- A failing pass never stops the run.
- A missing base part fails its sources and empties its fields.
- A missing enrichment part leaves the base data standing and adds one note.

**Reviews**
- At most 8 per run and at most 4 at once. Never from `team_review_prs`.
- A review id is `<owner>:<repo>:<number>:<head_sha>`.

**Reviews are `/pr-review` reviews.**
- The prompt comes from `plugins/pr-review/skills/pr-review/pr-review.sh` in
  `taxwire/taxwire-skills`, read at the start of each run.
- The run can't invoke that skill. Routine sessions don't load plugins, and
  the script needs `gh` and the `claude` CLI.
- `review-prompt.md` is the fallback copy.

**Search caps**, so the day is bounded whatever Slack's limits are:
- Slack enrichment makes at most 1 search per PR (12 PRs at most) and 1 per
  external meeting (5 meetings at most).
- It makes at most 1 user search per name (10 names at most).
- Gmail enrichment makes at most 1 search per external meeting (5 at most).

**Hand-offs carry keys, URLs and emails.** Prose appears only in the
summaries the Drive synthesiser reads.

**Delivery**
- `--mode full` keeps working until the user drops it: the full prompt
  carries the scripts.
- Don't change the live Routine (its prompt, model, repositories, or a fire)
  without the user's go-ahead.
- `main` is what runs. Work on a branch, and merge after Task 6's review.

## Review Focus

1. **A pass writes a field it doesn't own**, a misspelt field, or a hand-off
   `parts.md` doesn't give it. The merge rejects all three (Task 2).
2. **A pass dies, or leaves half-written JSON.**
   - For a base pass, its sources read as failed.
   - For an enrichment, the base data stands and one note names what may be
     missing (Task 2).
3. **A Slack ping about a review PR comes from someone other than its
   author.** It doesn't set `blocking_signal` when the author's email is
   known (Task 2).
4. **`/pr-review`'s Summary changes.** Small variations still parse. A
   template without Totals or Verdict falls back to the copy, with a note
   (Task 3).
5. **A teammate email isn't a valid document id.** It is left out of the
   atomic batch, with a note (Tasks 2 and 3).
6. **`parts.md` gains a cycle, a third pass for a source, or a read from the
   same or a later wave.** The contract tests fail (Task 1).

---

### Task 1: `parts.md` and the contract as data

**Files:**
- Create: `.claude/skills/morning-return-run/parts.md`,
  `.claude/skills/morning-return-run/scripts/contract.py`,
  `tests/test_contract.py`

**Interfaces:**
- Produces `parts.md`, with one table and these columns: Part, Unit, Wave,
  Tools, Model, Effort, Reads, Fields, Sources, Hand-offs.

  | Part | Unit | Wave | Tools | Model | Effort | Reads | Fields | Sources | Hand-offs |
  |---|---|---|---|---|---|---|---|---|---|
  | header | SKILL.md | 0 | — | — | — | — | `run_date`, `generated_at`, `since`, `login`, `environment`, `page_url`, `timezone`, `notes` | — | — |
  | `github.json` | github.md | 1 | github | sonnet | medium | — | `review_prs`, `team_review_prs`, `my_prs`, `stale_closed` | `github` | `repos`, `pr_keys`, `commit_identities` |
  | `sessions.json` | sessions.md | 1 | sessions | haiku | medium | — | — | `sessions` | `branches` |
  | `slack.json` | slack.md | 1 | slack | sonnet | high | — | `slack_asks`, `slack_discussions` | `slack` | `pr_links`, `ask_senders`, `seen` |
  | `gmail.json` | gmail.md | 1 | gmail | sonnet | high | — | `mail_asks` | `gmail` | `invites`, `senders` |
  | `calendar.json` | calendar.md | 1 | calendar | haiku | low | — | `day_blocks`, `out_of_office` | `calendar` | `events`, `meeting_keys`, `ooo_names` |
  | `linear.json` | linear.md | 1 | linear | sonnet | medium | — | `linear`, `linear_asks` | `linear` | `linear_names` |
  | `slack-enrich.json` | slack-enrich.md | 2 | slack | sonnet | medium | github, calendar, gmail, linear | — | — | `pr_mentions`, `meeting_threads`, `names`, `people_profiles` |
  | `gmail-enrich.json` | gmail-enrich.md | 2 | gmail | sonnet | medium | calendar, gmail | — | — | `meeting_threads` |
  | `linear-enrich.json` | linear-enrich.md | 2 | linear | haiku | low | github | — | — | `issues` |
  | `meetings.json` | meeting-prep.md | 3 | drive | opus | high | calendar, gmail, slack-enrich, gmail-enrich | `meetings` | — | — |
  | `github-enrich.json` | github-enrich.md | 3 | github | haiku | low | github, linear-enrich | — | — | `pr_states` |
  | `reviews.json` | scripts | — | — | — | — | — | — | — | `review_ids`, `queued`, `prompt` |
  | merge | merge_brief.py | — | — | — | — | — | `linear_issues` | — | — |

  Review subagents are not parts. Their row lives in a second, smaller table
  in `parts.md`: `review`, reviews.md, tools `github` (diff-only fallback) +
  `Bash`, model opus, effort xhigh. Below the tables, `parts.md` gives:
  - **Keys:**
    - `pr_key` = `owner/repo#number`.
    - `meeting_key` = the Meeting's `url`: the calendar event's link, or the
      invite's view link.
  - **A part file's shape:**
    `{"sources": {...}, "fields": {...}, "notes": [...], "handoffs": {...}}`.
  - **Each hand-off's shape, one line each:**
    - `repos`: `[{repo, clone}]`.
    - `pr_keys`: `[{key, url, title, head_ref, author}]`, for every PR in
      the base fields.
    - `commit_identities`: `{login: [{name, email}]}`, from `get_commits`.
    - `branches`: `[{repo, branch, finished}]`.
    - `pr_links`: `[{url, pr: {repo, number}, from_email, to_me, when, line}]`,
      for PR links in messages the base pass already read.
    - `ask_senders` and `senders`: `{item url: email}`.
    - `seen`: the permalinks the base pass read.
    - `invites`: Meetings with `on_calendar: false`.
    - `events`: Meetings with `context` and `action` set to `null`.
    - `meeting_keys`:
      `[{key, title, start, attendees, external_domains, recurring}]`.
    - `ooo_names` and `linear_names`: lists of names.
    - `pr_mentions`: Items plus `pr`, `from_email`, `to_me` and `line`.
    - `meeting_threads`: `{meeting_key: [{url, when, who, summary}]}`.
    - `names`: `{name: email | null}`.
    - `people_profiles`: `{email: {name, photo_url}}`.
    - `issues`: `{identifier: {title, url, status, pr_urls}}`.
    - `pr_states`: `{pr url: "open" | "merged" | "closed"}`.
    - `review_ids`: `{pr_key: id}`.
    - `queued`: a number.
    - `prompt`: `"live"` or `"copy: <why>"`.
  - **Tools:** maps each tool name in the table to the tool names a pass with
    it may hold. Task 5 fills in the exact names from the spike.
- Produces, in `contract.py`:
  - `brief_fields(text) -> dict[str, set[str]]`, with keys `"brief"`,
    `"PR"`, `"Meeting"`, `"Item"` and `"Linear"`. Each is the set of
    backticked names in the first cell of that record's table; multi-name
    cells give every name.
  - `sources(text) -> set[str]`, read from the braces in the `sources` row.
  - `ownership(text) -> dict[str, Part]`, where `Part` is a `NamedTuple` of
    `unit`, `wave: int | None`, `tools`, `model`, `effort`,
    `reads: set[str]`, `fields: set[str]`, `sources: set[str]` and
    `handoffs: set[str]`.
  - `validate(brief, fields) -> list[str]`. Errors look like
    `my_prs[2]: missing head_sha` or `meetings[0].action: unknown foo`. It
    covers the top level, every PR, Meeting and Item list, `linear`, and
    `sources`' keys.

- [ ] **Step 1: Write the failing tests** in `tests/test_contract.py`.
  - `test_the_fixture_brief_meets_the_contract`
  - `test_a_missing_pr_field_is_named_with_its_path`
  - `test_an_unknown_field_is_named`
  - `test_multi_name_cells_give_every_name`
  - `test_every_brief_field_has_exactly_one_owner`
  - `test_every_source_has_one_owner_and_it_is_a_base_part`
  - `test_parts_form_a_dag_by_wave`: every name in Reads has a strictly
    lower wave.
  - `test_at_most_two_passes_per_source`: count the rows per Tools value,
    excluding reviews.
  - `test_enrichments_own_no_fields_or_sources`: a wave-2 part with Reads
    owns nothing. The one exception is `meetings.json`, the synthesiser.
  - `test_every_unit_named_exists`
  - `test_models_and_efforts_are_known`: models are one of `haiku`,
    `sonnet`, `opus` or `fable`; efforts are one of `low`, `medium`, `high`,
    `xhigh` or `max`.

- [ ] **Step 2: Run them to watch them fail.**
  `python3 -m unittest tests.test_contract -v` should fail with an import
  error.

- [ ] **Step 3: Write `parts.md` and implement `contract.py`.** If the
  fixture fails validation, fix whichever of the fixture and the contract is
  wrong, and say which in the commit.

- [ ] **Step 4: Run all the tests.** Expect them all to pass.

- [ ] **Step 5: Sabotage.**
  1. Drop `head_ref` from the PR table; the fixture test must fail.
  2. Make `slack-enrich` read `meetings`; the DAG test must fail.
  3. Restore both.

- [ ] **Step 6: Commit** with `feat(run): parts.md and the contract as data`.

### Task 2: Merging the parts, and which passes to start

**Files:**
- Create: `.claude/skills/morning-return-run/scripts/merge_brief.py`,
  `.claude/skills/morning-return-run/scripts/plan_waves.py`,
  `tests/test_merge_brief.py`

**Interfaces:**
- Consumes `contract.*`.
- Produces `merge_brief.py --run-dir <skill dir> --scratch <dir> [--skip <part> ...]`:
  - It reads `header.json` and `parts/*.json`.
  - It writes `brief.json` and `writes.json` (the review documents).
  - It prints the three Finish lines.
  - It exits 1 on validation errors.
- Produces
  `merge(header, parts: dict[str, dict | None], format_text, parts_text) -> (brief, writes, errors)`.
  The merge applies each rule below; each rule gets a test.
  1. **Parts it can't use.** Each part must be valid JSON whose `fields`,
     `sources` and `handoffs` are what `parts.md` gives it. Anything else is
     an error naming the part and key.
  2. **A missing base part.** Its sources are
     `{"ok": false, "error": "<unit> didn't finish"}` and its fields take
     their empty values: lists `[]`, `linear` with three empty lists,
     `linear_issues` `{}`.
  3. **A missing enrichment part.**
     - Its hand-offs are empty.
     - The base fields stand.
     - Sources are unchanged.
     - One note says what may be missing. For example: "Slack enrichment
       didn't finish: PR discussions and blocking signals may be missing."
  4. **Meetings.**
     - If it exists, use `meetings.json`.
     - Otherwise, use `calendar.events` plus `gmail.invites`, dropping an
       invite whose start and title match a calendar event.
  5. **Emails.**
     - `author_email` comes from `commit_identities[login]`: the first email
       on `taxwire.com`.
     - Failing that, it comes from `names[<that identity's name>]`.
     - The same goes for each requested reviewer's email.
  6. **Blocking signals.** Combine `pr_mentions` and `pr_links`, deduped by
     `url`. A review PR takes the `line` of the first mention with
     `to_me: true` whose `from_email` is its author's, or any such mention
     when the author is unknown.
  7. **Discussions about my PRs.** A mention whose PR is in `my_prs` becomes
     a `slack_discussions` Item.
     - The extra keys are dropped.
     - `tag` becomes `<short repo>#<number>`.
     - A mention whose URL is already listed is skipped.
     - The list stops at 8.
  8. **Meeting tags.** A `mail_asks` or `slack_asks` Item whose sender
     (`senders`, `ask_senders`) attends a meeting today gets that meeting's
     tag: its `org`, or else its title, then ` HH:MM`. If the Item has an
     `action`, its `by` is set to the meeting's start.
  9. **Out of office.** Entries take their email from `names`. Unmatched
     entries are dropped.
  10. **Linear issues.** `linear_issues` comes from `issues`. Each PR URL's
      `state` is:
      - `open` when the PR is in the brief;
      - otherwise from `pr_states`;
      - otherwise the PR is left out.
  11. **Review ids.** `review_ids` set `review_id` on PRs.
  12. **The review prompt.** When `prompt` isn't `"live"`, add the note
      `Reviews used the saved copy of the /pr-review prompt: <why>.`
  13. **Notes.** Header notes first, then base parts, then enrichments. Keep
      4; the rest go to stderr.
  14. **Writes.** `writes.json` lists
      `{op: "set", collection: "reviews", doc_id, file_path}`. It leaves out
      ids that don't match `^[A-Za-z0-9._~:@+-]{1,200}$`, with a note.
  15. **Finish lines.**
      1. The count in each list.
      2. `Reviews: <new> run, <already> already reviewed, <queued> queued`.
      3. Failed sources, or `No source failed`.
- Produces `plan_waves.py --scratch <dir> --wave 2|3`. It prints one line
  per pass of that wave that has work, and nothing for the others:
  - `slack-enrich` when there are PRs, external meetings or names;
  - `gmail-enrich` when there's an external meeting;
  - `linear-enrich` when any PR has a `linear_id`;
  - `meetings` when there are any meetings;
  - `github-enrich` when `issues` hold PR URLs not in the brief.

- [ ] **Step 1: Write the failing tests** in `tests/test_merge_brief.py`.
  - A helper `split(brief)` cuts `tests/fixtures/brief.json` into a header,
    base parts, enrichment parts and `meetings.json`, so the merge's inputs
    are realistic.
  - `test_split_and_merged_back_is_the_fixture`
  - One test per rule:
    - `test_a_part_with_a_field_it_doesnt_own_is_an_error`
    - `test_a_handoff_the_part_doesnt_declare_is_an_error`
    - `test_a_misspelt_field_is_an_error`
    - `test_a_missing_base_part_fails_its_sources`
    - `test_truncated_json_counts_as_missing` (through the CLI)
    - `test_a_missing_enrichment_keeps_the_base_fields`
    - `test_without_meeting_prep_events_and_invites_stand`
    - `test_an_invite_matching_a_calendar_event_is_dropped`
    - `test_emails_come_from_commits_then_names`
    - `test_a_ping_from_someone_else_isnt_blocking`
    - `test_a_ping_counts_when_the_author_is_unknown`
    - `test_a_mention_of_my_pr_becomes_a_discussion_once`
    - `test_mail_and_slack_from_an_attendee_are_tagged`
    - `test_out_of_office_without_an_email_is_dropped`
    - `test_linked_pr_states_come_from_the_brief_then_github`
    - `test_a_copied_review_prompt_adds_a_note`
    - `test_notes_keep_four_header_first`
    - `test_a_bad_doc_id_is_left_out_with_a_note`
    - `test_finish_lines`
  - `plan_waves` tests:
    - `test_nothing_to_enrich_starts_nothing`
    - `test_an_external_meeting_starts_gmail_enrich`

- [ ] **Step 2: Run them to watch them fail.**

- [ ] **Step 3: Implement both scripts.**

- [ ] **Step 4: Run all the tests.** Expect them all to pass.

- [ ] **Step 5: Sabotage.**
  1. Skip the author check on pings; the ping test must fail.
  2. Let enrichments write fields; the ownership test must fail.
  3. Restore both.

- [ ] **Step 6: Commit** with `feat(run): merge_brief.py and plan_waves.py`.

### Task 3: The review prompt, queue and documents, and the people fetcher

**Files:**
- Create in `.claude/skills/morning-return-run/scripts/`: `review_prompt.py`,
  `review_queue.py`, `review_doc.py` and `people_docs.py`.
- Create: `tests/test_reviews.py`, `tests/test_people_docs.py`
- Modify: `.claude/skills/morning-return-setup/assemble_prompt.py`. It
  imports `extract_review_prompt` from `review_prompt.py`.

**Interfaces:**
- Produces
  `review_prompt.py --scratch <dir> [--script <pr-review.sh>] --copy <review-prompt.md>`.
  - It writes `<scratch>/review-prompt.md` and `prompt` into
    `parts/reviews.json`.
  - The live heredoc is kept when it has all four `@@…@@` placeholders and
    an output template that `review_doc`'s patterns match.
  - Otherwise it uses the copy, with `prompt: "copy: <why>"`.
- Produces `review_queue.py ids --scratch <dir>` and
  `review_queue.py pick --scratch <dir> --existing <file> --limit 8`.
  - The order is reviews.md's. A `to_me` entry in `slack.pr_links` counts
    as a blocking signal for ordering.
  - It dedupes by id.
  - `pick` prints `{"run": [{id, repo, number, head_sha, head_ref, base_ref, clone}], "queued": n}`
    and writes `review_ids` (existing) and `queued`.
- Produces
  `review_doc.py --scratch <dir> --markdown <file> --id <id> --reviewed-at <iso>`.
  - It writes `<scratch>/reviews/<id>.json` and records the id.
  - Exit 1 when the Summary doesn't parse.
  - Totals:
    `^- Totals: Critical (\d+), High (\d+), Medium (\d+), Low (\d+)`,
    case-insensitive, with any spaces and any suffix.
  - Verdict: `^- Verdict: (blocking|needs-work|minor|ship-ready)\b`,
    case-insensitive, stored in lower case.
- Produces
  `people_docs.py --scratch <dir> --existing <dir> --versions <file> --now <iso>`.
  - `ArtifactData`'s saved files hold only the document data, so the
    orchestrator writes `--versions` (`{email: version}`) from the list
    result.
  - An existing document whose version isn't known is left alone.
  - It finds every teammate email the brief names (as `app.js`'s
    `personEmails` does), whose document is missing or more than 30 days
    old.
  - For each, it takes the name and `photo_url` from
    `slack-enrich.people_profiles`.
  - It fetches the photo only over `https://` from the two allowed hosts,
    with a 5-second timeout. It crops the photo square, scales it to 64×64
    and saves it as a JPEG data URI.
  - It writes `<scratch>/people/<email>.json` and appends
    `{op: "set", collection: "people", doc_id, file_path, if_version?}` to
    `writes.json`. `if_version` comes from the existing document.
  - A failed fetch gives `photo: null`.

- [ ] **Step 1: Write the failing tests.**
  - In `test_reviews.py`:
    - `test_candidates_in_order`
    - `test_existing_reviews_are_dropped_and_recorded`
    - `test_past_the_limit_is_queued`
    - `test_the_template_summary_parses`
    - `test_capitals_and_spaces_parse`
    - `test_no_totals_line_is_rejected_and_writes_nothing`
    - `test_markdown_is_kept_byte_for_byte`
    - `test_the_live_prompt_is_used_when_it_still_fits`
    - `test_a_live_prompt_without_the_summary_lines_falls_back`
    - `test_a_missing_script_falls_back`
    - `test_the_copy_matches_pr_review_today` (skipped unless
      `../taxwire-skills` is checked out)
  - In `test_people_docs.py`, with the fetch injected as a function, so
    there is no network:
    - `test_only_missing_or_old_people_are_written`
    - `test_a_photo_from_another_host_is_never_fetched`
    - `test_photos_come_out_64_square_jpeg`
    - `test_a_failed_fetch_writes_a_null_photo`
    - `test_an_existing_document_is_pinned_to_its_version`

- [ ] **Step 2: Run them to watch them fail.**

- [ ] **Step 3: Implement the four scripts.**

- [ ] **Step 4: Run all the tests.** Expect them all to pass.

- [ ] **Step 5: Sabotage.**
  1. Make the Verdict regex case-sensitive.
  2. Drop the host check.
  3. Watch the matching tests fail, then restore both.

- [ ] **Step 6: Commit** with `feat(run): review and people scripts; reviews take the /pr-review prompt`.

### Task 4: The units and the orchestrator

**Files:**
- In `.claude/skills/morning-return-run/`:
  - Create:
    - `sessions.md`, from SKILL.md's section;
    - `slack.md`, `gmail.md`, `slack-enrich.md` and `gmail-enrich.md`, from
      `comms.md`, `meeting-prep.md` and `people.md`;
    - `linear-enrich.md` and `github-enrich.md`, from `linear.md`.
  - Rewrite: `meeting-prep.md`, as Drive-only, synthesising from the parts.
  - Modify: `SKILL.md`, `github.md` (gains `get_commits` →
    `commit_identities`), `calendar.md`, `linear.md` and `reviews.md`.
  - Delete: `comms.md` and `people.md`.
- Also modify: `assemble_prompt.py`, `tests/test_assemble_prompt.py`,
  `README.md` and `CLAUDE.md`.

**Interfaces:**
- **Each unit** ends with an `## Output` section of two or three lines:
  - its part file;
  - "write it as `parts.md` describes";
  - its search caps, where it has any.
- **`reviews.md`** opens by saying these are `/pr-review` reviews, and why
  the run can't invoke the skill. The review subagent writes only
  `<scratch>/reviews/<repo>-<number>.md`.
- **`SKILL.md`** steps:
  1. **Dates and this session.** Write `header.json`, and `get` today's
     brief for its version.
  2. **Wave 1.** Start six subagents in one message. Meanwhile, fetch
     `pr-review.sh` (with `add_repo` and a sparse clone; the content never
     enters the orchestrator's context), then run `review_prompt.py`.
  3. **Between waves.**
     - `review_queue.py ids`; `get` each id; write `existing.txt`; `pick`.
     - Clones and worktrees.
     - `ArtifactData` `list` `people` with `out_dir`.
     - `plan_waves.py --wave 2`.
  4. **Wave 2.** Start reviews 1–4 and the wave-2 passes in one message.
  5. **Wave 3.** `plan_waves.py --wave 3`, then reviews 5–8 and the wave-3
     passes in one message.
  6. **Documents.** Run `review_doc.py` on each review.
  7. **Merge.** On errors, rerun the named pass once with the error lines,
     then merge again. If it fails again, merge with `--skip <part>`.
  8. **People.** Run `people_docs.py`.
  9. **Write.** `batch` the entries of `writes.json` (at most 50 per call),
     then `set` the brief, with `if_version` when it exists.
  10. **Finish.** Print the merge's three lines.
- **Dispatch.** Each subagent is started with the model and effort from
  `parts.md`: through its agent definition after Task 5, or through the
  Agent tool's `model` and `effort` until then. The prompt template, given
  once in SKILL.md:

  > Read `<dir>/rules.md`, `<dir>/brief-format.md` and `<dir>/parts.md`,
  > then follow `<dir>/<unit>.md`. Page: …; GitHub login: …; Timezone: …;
  > run_date: …; window start: …; scratch: `<scratch>`. Reply with one line:
  > done, or failed: <why>.

- **`assemble_prompt.py`.** `ORDER` covers every unit and `parts.md`.
  `--mode full` appends `scripts/*.py` as fenced `# File: scripts/<name>`
  blocks, which the run writes out first.

- [ ] **Step 1: Write the failing tests** in `tests/test_assemble_prompt.py`.
  - `test_full_carries_every_script_verbatim`
  - `test_every_script_the_orchestrator_names_exists`
  - `test_every_part_has_a_unit_with_an_output_section_naming_it`
  - `test_the_order_covers_every_run_file`
  - `test_only_rules_md_states_the_rules`

- [ ] **Step 2: Run them to watch them fail.**

- [ ] **Step 3: Write the units, rewrite SKILL.md, and extend the
  assembler.**

- [ ] **Step 4: Dry-run the scripts end to end**, from Task 2's `split()`
  parts, in a scratch directory:
  1. `review_prompt.py`, using the copy;
  2. `review_queue.py ids`, then `pick`;
  3. `review_doc.py` on a sample review;
  4. `plan_waves.py` for both waves;
  5. `merge_brief.py`;
  6. `people_docs.py` with an existing directory and no network.

  Expected: a valid `brief.json`, a `writes.json` with the review, and the
  three Finish lines.

- [ ] **Step 5: Run all the tests.** Expect them all to pass.

- [ ] **Step 6: Commit** with `feat(run): passes by source in three waves`.

### Task 5: Agent definitions (behind a spike)

**Files:**
- Create: `.claude/agents/mr-<part>.md`, one per pass and one for `review`.
- Create: `docs/routine-environment.md`, `tests/test_agents.py`
- Modify: `parts.md` (the Tools section's exact names), `SKILL.md` and
  `CLAUDE.md`

- [ ] **Step 1: Spike** (no code). With the user's go-ahead, run one
  throwaway `create_session` on this branch with
  `.claude/agents/mr-probe.md` committed. The probe has `model: haiku`,
  `effort: low`, and `tools:` naming one Slack read tool and Read. Record in
  `docs/routine-environment.md` what the session reports:
  - the subagent types its Agent tool offers;
  - the exact tool names for Slack, Gmail, Calendar, Drive, Linear, GitHub,
    `ArtifactData`, `list_sessions` and `list_environments`;
  - whether the probe could call its Slack tool through `ToolSearch`;
  - which model and effort the probe ran at;
  - how many Agent calls in one message run at once.

- [ ] **Step 2: Decide.**
  - **If agent definitions load and are honoured:** write one per pass, plus
    `mr-review`. The front matter is `name`, `description`, `model`,
    `effort`, and `tools` (exactly its source's read tools from the Tools
    section, plus the common ones). The body is the prompt template.
  - **If not:** keep the Agent tool's `model`/`effort` dispatch. Note in
    `docs/routine-environment.md` that `rules.md` is the only guard on
    tools.
  - Delete `mr-probe.md` either way.

- [ ] **Step 3: Write the tests** in `tests/test_agents.py`, only if the
  agents are kept.
  - `test_every_pass_has_an_agent`
  - `test_agent_model_and_effort_match_parts_md`
  - `test_agent_tools_are_its_sources_and_the_common_ones`

- [ ] **Step 4: Run all the tests, then sabotage.**
  1. Give `mr-slack` a Gmail tool; the tools test must fail.
  2. Restore.

- [ ] **Step 5: Commit** with `feat(run): agents with one source's tools each`.

### Task 6: Review and go live

- [ ] **Step 1:** Run a fresh whole-branch review (the code-review skill,
  against `main`), and fix what it confirms.

- [ ] **Step 2: Merge to `main`.**

- [ ] **Step 3: With the user.**
  1. They attach `heuels/morning-return` to the Morning brief Routine.
  2. On their go-ahead, `update_trigger` with the stub prompt and
     `model: claude-opus-5-5`, then `fire_trigger` once.

- [ ] **Step 4: Verify** with setup's Verify section, plus these checks:
  - There is no "didn't finish" note.
  - Each PR whose author pinged you has its `blocking_signal` set.
  - Meetings carry `context`.
  - The orchestrator's events show no review markdown.
  - The duration is no worse than the last single-thread run.

- [ ] **Step 5:** Report to the user. Propose dropping `--mode full` two
  weeks after a clean run.
