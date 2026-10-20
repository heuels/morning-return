---
name: morning-return-setup
description: "Set up, update or check Egor's morning return: the Morning brief Routine that runs every weekday, and the Morning Routine Artifact page it fills. Use when the user asks to set up, update, re-install, fix or verify the morning return, the morning brief, its page or its Routine, or to run it now."
---

# Morning return setup

A claude.ai Routine, **Morning brief**, starts a fresh cloud session every
weekday morning. With this repository attached, that session loads the
`morning-return-run` skill from `.claude/skills/morning-return-run/` and
follows its SKILL.md. The run gathers GitHub, Claude sessions, Slack, Gmail,
calendars and Linear in passes, one subagent per source and wave (see the
run's `parts.md`), runs `/pr-review` reviews, and writes the result into the
database of one private Artifact page, built from `page/`, which ranks and
shows it. Outside that page it only reads: it never posts, replies, reviews on
GitHub or merges.

The Routine's stored prompt is a short stub naming the page, login and
timezone. Everything else comes from this repository, so a change reaches the
next run once it is pushed to `main`. Only people who can push here change what
runs.

## Setup

Run this from an interactive session that has this repository checked out.
Paths below are relative to the repository root.

1. **Who and when.** `get_me` gives the GitHub login. The timezone is
   `Europe/Lisbon` unless the user names another.
2. **Existing install.** `list_triggers`, and `get_trigger` each one whose
   prompt names a claude.ai artifact on a `Page:` line. The one whose prompt
   asks to run the morning return (or, from older installs, starts with
   `# Morning routine run`) is the install, whatever its name: take its id and
   the page URL from that line. Today that is the Routine named
   `Morning brief`. There should be at most one; if there are several, ask the
   user which to keep.
3. **Publish the page.** Publish `page/index.html` with `root: "page"` and
   `files: ["styles.css", "app.js", "render.js", "rank.js", "review.js", "icons.js", "markdown.js", "session.js", "ui.js"]`
   (never `package.json`, which is only for the tests). A page that already
   carries other files, such as a `fonts.css`, keeps them; leave them out of
   `files`.
   - New install: `capabilities: {db: {}, user: {}, mcp: {servers: [{server: "Claude Code Remote", tools: ["create_session"]}]}}`
     (the `mcp` entry lets the page start Claude Code sessions; the viewer
     allows it on first use), `icon: "sunrise"`, description
     `Your morning return: PRs to review, fix and merge, today's meetings with context, replies owed, Linear and Slack threads worth knowing.`
   - Existing install: read the page first (`action: "read"` on its URL), then
     publish with `url` set to it, the same `capabilities` as a new install and
     no `icon`, which keeps the page's database and its link.
4. **Build the prompt** into the scratchpad:

   ```bash
   python3 .claude/skills/morning-return-setup/assemble_prompt.py \
     --github-login <login> --timezone <tz> --artifact-url <page url> \
     --out <scratchpad>/morning-return-prompt.md
   ```

   That is the stub, for a Routine with this repository attached. Add
   `--mode full` for one without it: the prompt then carries every file of the
   run, and a change here reaches it only when setup runs again.
5. **Create or update the Routine.**
   - Existing: `update_trigger` with the Routine's id and the new `prompt`
     only. Its repositories, connectors and schedule stay as they are.
   - New: Routines that read GitHub, list sessions and load this repository's
     skills need repositories selected, which only claude.ai's Routines page
     can do. Give the user the prompt file and have them create a Routine
     named `Morning brief` there:
     - schedule: weekdays at 07:45 in their timezone
     - model: Claude Opus 5.5 (the orchestrator; each pass's model is in
       the run's `parts.md`)
     - connectors: Slack, Gmail, Google Calendar, Google Drive and Linear
     - repositories: `heuels/morning-return` and the `taxwire/*` repositories
       the brief should cover
6. **Run it once.** `fire_trigger` the Routine, then **Verify**.

## Verify

1. `get_trigger` for the run's `last_run.session_id`, then `get_session` on it
   until its turn ends. If its `status_bucket` reads blocked, it is waiting on
   a permission prompt: tell the user which tool it was waiting on
   (`list_events` on the session shows it). If the run says the repository
   isn't checked out, it isn't attached to the Routine: go back to step 5.
2. `ArtifactData` `query` `briefs` (`order_by` `run_date` desc, `limit` 1) and
   `list` `reviews`. Today's brief should exist, every `sources` entry should
   be `ok` or carry an error line, each review the run reported should have
   a document, and no note should say a pass didn't finish.
3. Compare the brief's `my_prs` numbers with `search_pull_requests`
   `is:open author:<login>` over the same repos.
4. Open the page (`action: "open"`) and tell the user what was checked, what
   the run found, and anything that failed.

## Updating

- **The run** (`.claude/skills/morning-return-run/`): push to `main`. The next
  run picks it up. A Routine on the full prompt needs setup steps 4 and 5
  again.
- **The page** (`page/`): setup step 3.
- **A pass's tools, model or effort**: change `parts.md`, run
  `python3 .claude/skills/morning-return-setup/write_agents.py`, push.
- **The review prompt**: every run reads `/pr-review`'s prompt from
  taxwire-skills' `pr-review.sh`. `review-prompt.md` is the copy it falls
  back on; `tests/test_reviews.py` flags it when it drifts from
  taxwire-skills' `main`. Refresh it with
  `assemble_prompt.py --sync-review-prompt <path to pr-review.sh>`, then push.

## Troubleshooting

- **A source shows "Couldn't reach …"**: its connector isn't granted to the
  Routine. Add it on the Routine's page in claude.ai.
- **A repo is missing**: the run's `notes` say `add_repo` refused it; the
  user's GitHub access to that repo decides.
- **A source fails every day after a connector was reconnected**: its new
  connector id isn't in `parts.md`'s Tools table, so the pass's agent has no
  tools for it. See `docs/routine-environment.md`.
- **The page says "No brief yet"**: check the Routine's `last_run` with
  `get_trigger`, then that session with `get_session`.
- **A review never appears**: the run's `notes` say whether it was queued past
  the 8-per-run limit or failed; either way the next run tries it again.
