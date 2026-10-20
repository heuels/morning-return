---
name: morning-return-run
description: "Runs Egor's morning return: gathers GitHub, Claude sessions, Slack, Gmail, calendars and Linear, reviews PRs, and writes the brief to the Morning Routine page's database. Use only when a prompt asks to run the morning return, as the Morning brief Routine does."
---

# Morning return run

You are running the user's morning return. Nobody is watching this session.
You are the orchestrator: you start the passes that gather, review and
prepare, run the scripts that join their results, and write the page's
database. "I", "me" and "my" in these files and in the brief format mean the
user.

The prompt that started this run gives the page link, my GitHub login and my
timezone. `{{ARTIFACT_URL}}`, `{{GITHUB_LOGIN}}` and `{{TIMEZONE}}` in these
files stand for them. `<skill>` below is this skill's directory: the other
files of the run sit in it, and its scripts in `<skill>/scripts/`. A prompt
that carries every file of the run instead (`# File:` headings) has no such
directory: write every `# File: <name>` section to `<scratch>/run/<name>`
(for a script, the code inside its fence) and use `<scratch>/run` as
`<skill>`.

Read rules.md, brief-format.md and parts.md first. rules.md binds you and
every pass; brief-format.md is what the page reads; parts.md lists every
pass, what it reads and what it owns.

## How a pass runs

A pass is a subagent (the `Agent` tool) that follows one unit file and writes
one part file. Start each with the model and effort its parts.md row gives.
When an agent named `mr-<part>` is available, use it; otherwise use
`general-purpose` with that model and effort. Give it this prompt, filled in:

> You are one pass of the morning-return run. Read `<skill>/rules.md`,
> `<skill>/brief-format.md` and `<skill>/parts.md`, then follow `<skill>/<unit>`.
> Page: <page>. GitHub login: <login>. Timezone: <timezone>. Today
> (run_date): <run_date>. Window start: <since or the window start>.
> Scratch: `<scratch>`. In those files `{{ARTIFACT_URL}}`, `{{GITHUB_LOGIN}}`
> and `{{TIMEZONE}}` stand for the page, login and timezone above. Write
> your part to `<scratch>/parts/<part>.json`. Reply with one line: `done`, or
> `failed: <why>`.

Start every pass of a wave in one message, so they run together. A pass
that replies `failed`, or doesn't reply, leaves no part file or a broken
one; the merge copes with either. Don't read part files yourself: the
scripts do.

## Steps

1. **Dates and this session.** Make the scratch directory (`mktemp -d`) with
   `parts/` and `reviews/` in it. `run_date` is today's date in
   {{TIMEZONE}}. `ArtifactData` `query` on `briefs`, `order_by` `run_date`
   descending, `limit` 2: the newest one whose `run_date` is before today
   gives `since` (its `generated_at`); with none, `since` is `null` and the
   window starts 3 days ago on a Monday, 1 day ago otherwise. If today's
   brief already exists, keep its `version`. `get_session` with no
   `session_id` gives this session's `environment_id`; `list_environments`
   gives its name. Write `<scratch>/header.json`:
   `{run_date, since, login, environment: {id, name}, page_url, timezone, notes: []}`.
2. **Wave 1.** Start the wave-1 passes (parts.md). While they run, get the
   review prompt: `add_repo` `taxwire/taxwire-skills` with `access: "read"`,
   `git clone --depth 1 --filter=blob:none --no-checkout <url> <scratch>/skills`,
   `git -C <scratch>/skills show HEAD:plugins/pr-review/skills/pr-review/pr-review.sh > <scratch>/pr-review.sh`,
   then `python3 <skill>/scripts/review_prompt.py --scratch <scratch> --script <scratch>/pr-review.sh --copy <skill>/review-prompt.md`.
   If any of that fails, run `review_prompt.py` without `--script`. Never
   open `pr-review.sh` yourself.
3. **Between waves.** When wave 1 is back:
   - `python3 <skill>/scripts/review_queue.py ids --scratch <scratch>`; `ArtifactData`
     `get` each id on `reviews` and write the ones that exist to
     `<scratch>/existing.txt`, one per line; then
     `python3 <skill>/scripts/review_queue.py pick --scratch <scratch> --existing <scratch>/existing.txt`.
     Its `run` list is this run's reviews.
   - Make the clones and worktrees for them (reviews.md).
   - `ArtifactData` `list` `people` with `out_dir` `<scratch>/existing`
     (follow `next_cursor` to the end). Write `<scratch>/versions.json`,
     `{email: version}`, from the versions the listing shows. Then
     `python3 <skill>/scripts/people_docs.py --existing <scratch>/existing --now <now> --list-fresh > <scratch>/people-fresh.txt`.
   - `python3 <skill>/scripts/plan_waves.py --run-dir <skill> --scratch <scratch> --wave 2`
     names the wave-2 passes with work.
4. **Wave 2.** In one message, start the first four reviews (reviews.md) and
   the wave-2 passes it named.
5. **Wave 3.** When those are back,
   `python3 <skill>/scripts/plan_waves.py --run-dir <skill> --scratch <scratch> --wave 3`,
   then in one message start reviews 5 to 8 and the wave-3 passes it named.
6. **Review documents.** For each review that came back, run
   `python3 <skill>/scripts/review_doc.py --scratch <scratch> --markdown <its file> --id <its id> --reviewed-at <now>`.
   One that exits 1 is left for the next run.
7. **Merge.** Write `generated_at` (now, UTC) into `header.json`, then
   `python3 <skill>/scripts/merge_brief.py --run-dir <skill> --scratch <scratch>`.
   If it exits 1, each error names a part: start that part's pass once more,
   giving it the error lines, and merge again. If it fails again, merge with
   `--skip <part>` for each part still named.
8. **People.** `python3 <skill>/scripts/people_docs.py --scratch <scratch> --existing <scratch>/existing --versions <scratch>/versions.json --now <now>`.
9. **Write.** `ArtifactData` `batch` the entries of `<scratch>/writes.json` as
   they are, at most 50 per call. Then `set` `briefs/<run_date>` with
   `file_path` `<scratch>/brief.json`, passing the `version` from step 1 as
   `if_version` when today's brief already existed.
10. **Finish.** End with the three lines `merge_brief.py` printed.
