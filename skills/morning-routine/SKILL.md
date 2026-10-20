---
name: morning-routine
description: "Set up, update or check the user's morning routine: a weekday claude.ai Routine that ranks their PRs to review and to merge, runs pr-review's review prompt on direct review requests and their finished PRs, and gathers Slack, Gmail, Calendar and Linear into one Artifact page. Use when the user asks to set up, update, re-install, fix or verify their morning routine or morning brief page, or to run it now."
---

# Morning routine

A claude.ai Routine starts a fresh cloud session every weekday morning. That
session follows `run.md`, gathers GitHub, Claude sessions, Slack, Gmail,
Calendar, Linear, reviews PRs in subagents, and writes the result into the database of
one private Artifact page, which ranks and shows it. Outside that page it only
reads: it never posts, replies, reviews on GitHub or merges.

A Routine's session doesn't load this plugin, so setup copies everything the
run needs into the Routine's own prompt: `run.md`, `brief-format.md` and the
review prompt from `pr-review.sh`. Only the user can change what runs. A change
here reaches the Routine only when setup runs again.

## Setup

Run this from an interactive session that has `taxwire-skills` checked out.
Paths below are relative to this file's directory.

1. **Who and when.** `get_me` gives the GitHub login. The timezone is
   `Europe/Lisbon` unless the user names another.
2. **Existing install.** `list_triggers` and look for a Routine named
   `Morning routine`. If there is one, `get_trigger` it and take the page URL
   from its prompt's line `Page: <url>`.
3. **Publish the page.** Publish `page/index.html` with `root: "page"` and
   `files: ["styles.css", "app.js", "render.js", "rank.js", "review.js", "icons.js", "markdown.js", "session.js"]`
   (never `package.json`, which is only for the tests). A page that already
   carries a `fonts.css` keeps it; leave it out of `files`.
   - New install: `capabilities: {db: {}, user: {}, mcp: {servers: [{server: "Claude Code Remote", tools: ["create_session"]}]}}`
     (the `mcp` entry lets the page start Claude Code sessions; the viewer
     allows it on first use), `icon: "sunrise"`,
     description `Your morning return: PRs to review, fix and merge, today's meetings with context, replies owed and Slack threads worth knowing.`
   - Existing install: read the page first (`action: "read"` on its URL), then
     publish with `url` set to it, the same `capabilities` as a new install and
     no `icon`, which keeps the page's database and its link.
4. **Assemble the prompt** into the scratchpad:

   ```bash
   python3 assemble_prompt.py --github-login <login> --timezone <tz> \
     --artifact-url <page url> --out <scratchpad>/morning-routine-prompt.md
   ```

   Stop and report if it errors (a template placeholder or the review prompt
   in `pr-review.sh` changed shape).
5. **Create or update the Routine.**
   - New: `create_trigger` with `name: "Morning routine"`,
     `cron_expression: "CRON_TZ=<tz> 45 7 * * 1-5"`,
     `create_new_session_on_fire: true`,
     `connectors: ["Slack", "Gmail", "Google Calendar", "Google Drive", "Linear"]`,
     `initiation: "human_request"`, and the assembled file's contents as
     `prompt`.
   - Existing: `update_trigger` with the Routine's id and the new `prompt`
     only.

   If `create_trigger` refuses `connectors`, or warns that it stored none,
   don't create the Routine from here. A Routine created this way also gets
   no GitHub tools, no `list_repos`/`add_repo` and no `list_sessions`, so its
   runs gather nothing. Instead, give the user the assembled prompt file and
   have them create the Routine on claude.ai's Routines page, with the same
   name and schedule, the Slack, Gmail, Google Calendar, Google Drive and Linear
   connectors, and the
   `taxwire/*` repositories they want covered selected as its repositories.
   Then continue with step 6 on that Routine. Its runs still can't list
   Claude sessions, so drafts are reviewed only once they're marked ready for
   review.
6. **Run it once.** `fire_trigger` the Routine, then **Verify**.

## Verify

1. `get_trigger` (or `list_triggers`) for the run's `last_run.session_id`, then
   `get_session` on it until its turn ends. If its `status_bucket` reads
   blocked, it is waiting on a permission prompt: tell the user which tool it
   was waiting on (`list_events` on the session shows it).
2. `ArtifactData` `query` `briefs` (`order_by` `run_date` desc, `limit` 1) and
   `list` `reviews`. Today's brief should exist, every `sources` entry should
   be `ok` or carry an error line, and each review the run reported should
   have a document.
3. Compare the brief's `my_prs` numbers with `search_pull_requests`
   `is:open author:<login>` over the same repos.
4. Open the page (`action: "open"`) and tell the user what was checked, what
   the run found, and anything that failed.

## Updating

Pull the latest `taxwire-skills` and run Setup again. Steps 2 and 3 find the
existing page and Routine, so the link and schedule stay the same and the
stored prompt picks up changes to `run.md`, `brief-format.md`, the page and
`pr-review.sh`.

## Troubleshooting

- **A source shows "Couldn't reach …"**: its connector isn't granted to the
  Routine. Re-run Setup step 5, or add the connector to the Routine in
  claude.ai.
- **A repo is missing**: the run's `notes` say `add_repo` refused it; the
  user's GitHub access to that repo decides.
- **The page says "No brief yet"**: check the Routine's `last_run` in
  `list_triggers`, then that session with `get_session`.
- **A review never appears**: the run's `notes` say whether it was queued past
  the 8-per-run limit or failed; either way the next run tries it again.
