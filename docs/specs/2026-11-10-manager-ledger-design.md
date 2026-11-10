# Manager ledger: design

Status: draft for review · Owner: Egor Zaitsev (GitHub `heuels`) · 2026-11-10

## Why

Egor is moving into managing the Integrations team. MR-1 today is built
around his own work: his PRs, asks aimed at him, his meetings. As a manager
he needs four more things every morning:

- what he committed to, in calls, Slack and mail, until it's done;
- what his team's projects are doing, in one place, with the evidence;
- every deadline that touches him, his team or his projects;
- news that changes a project ("we have dev access to SAP now").

That context is spread over Gemini call notes, Slack, mail, the Notion
roadmap, Kent's Deployment Blockers page and Linear. He wants it kept in one
private Notion page he can read and tick off anywhere, and MR to bubble up
what matters today. He also wants a Refresh button on MR.

**Success, in his own examples (2026-11-10):**

| He wants to see | Where it is today |
|---|---|
| Follow-up: send Platinum Micro the answers and CEO note | Andrew Clegg in #opportunities, Nov 9. Egor emailed Methawat at 13:53 on Nov 10, so it shows as done. |
| Campfire OAuth app: done, but no customer migrated yet | Roadmap: Roll Out, 🟢, next stage Oct 30 passed. "No customer migrated" will come from a Slack message Egor posts. |
| Kent's (or Pau's) Sage question brings up Sage's context | Pau in #gtm, Nov 9. Context: the roadmap row (In Progress, "waiting for credentials", blocked on security review), the Linear project, taxwire/taxwire-typescript#1958. |
| Projects missing from the roadmap: Salesforce native, Tabs, SAP (EAE) | Salesforce: Kent's Deployment Blockers (due Nov 16, $85k), taxwire/taxwire-python#4550. Tabs: two Hockeystack calls and Steven's Tabs call. SAP: #internal-eae and mail. |
| SAP dev access is here, on MR and on the SAP project's page | Marissa in #internal-eae and Andrew Rea's "Fwd: EAE SAP Development system", Nov 9, a minute apart: one piece of news, two links. |
| Every deadline | Kent's Deployment Blockers, roadmap next-stage and completion dates, Linear target dates, and dates said in Slack, mail and calls. |

## What it is (approach A, chosen)

Three pieces:

1. **The ledger**: a private Notion page, *Egor · Integrations*, holding a
   team list, a **Commitments** database and a **Projects** database.
   Egor reads and edits it anywhere; the run keeps it up to date.
2. **The run**: new passes read call notes and Notion; a new *ledger pass*
   decides what changed; a script checks those changes; one *writer step*,
   the only part of the run allowed to write to Notion, applies them. The
   brief carries what MR should surface.
3. **MR**: new sections for news, follow-ups, deadlines, projects and
   projects missing from the roadmap; project status on asks that mention a
   project; a Refresh button.

## The ledger

One private page under Egor's private pages, created once by setup, never
by the run.

### Team

A short list at the top of the page: each teammate's name and Taxwire email.
Egor keeps it; the run only reads it. It decides whose commitments and
deadlines count as "my team's". Setup seeds it with the Integrations
roadmap's project owners (Aasim Sani, Jonathan Reiss, Chandler Brown, Lucas
Gerbeaux) and asks Egor to confirm or edit before the first run.

The same block holds **Watched channels**: the Slack channels the run reads
for project news. Setup seeds it with the channels where team project news
appeared in the last two weeks (#t-integrations, #t-deployments,
#internal-eae, #opportunities, #gtm); Egor edits it.

### Commitments

One database for everything dated or owed. Follow-ups are a view of it
filtered to Egor and not done; Deadlines is a view sorted by due date. One
list means nothing is tracked twice, and a follow-up with a date is a
deadline too.

| Property | Holds |
|---|---|
| What | One line, in the run's words (or Egor's, for rows he adds). |
| Whose | Egor, a teammate (from the team list), or a customer or partner. |
| Due | The date, or empty. |
| Due as said | "ASAP", "end of week": kept when the source gives no date, with the date it was said. |
| Project | Relation to Projects, or empty. |
| Source | The `https://` link where it came from: call notes, Slack message, mail thread, Linear issue, roadmap row, blockers page. |
| Done | Checkbox. |
| Done because | The link that shows it's done (Egor's sent mail, his Slack reply, a merged PR, a Linear issue closed), or empty when Egor ticked it himself. |
| Due history | "Nov 13 → Nov 16 (seen Nov 10)": every move the run saw. |
| Added by | `run` or `Egor`. |
| Key | The run's dedupe key (hidden in the views). |

### Projects

One row per project: every Integrations roadmap row, plus every project the
run sees real work on that isn't on the roadmap.

| Property | Holds |
|---|---|
| Name | The roadmap's name, or the run's for a project not on it. |
| Aliases | Other names it goes by ("SAP", "EAE", "SAP for EAE"), for matching Slack and mail to it. Egor can add more. |
| Roadmap | Link to the roadmap row; empty means *not on the roadmap*. |
| Owner's flag | The roadmap's On Track? value, mirrored as it is. |
| Run's read | One line, only when the evidence disagrees with the owner's flag ("past its Oct 30 date, no customer migrated"); otherwise empty. Always labelled as the run's. |
| Stage | The roadmap's Status. |
| Owner | The roadmap's DRI. |
| Next date | The roadmap's next-stage date (the earlier of it and the completion date). |
| Linear | The Linear project link. |
| Last update | Date of the newest line below. |
| Key | Roadmap row id, or a slug for projects not on it. |

Each project's page body is its **update list**: dated lines, newest first,
each one sentence in the run's words plus the links it came from:

```
Nov 9  Dev access to SAP is here; testing can start.  Marissa ↗ · Andrew Rea's mail ↗
Nov 6  Access expected soon.  Marissa ↗
Nov 5  Kent: EAE needs someone to drive the SAP API implementation.  ↗
```

### What the run may change

The writer step applies only these operations, each checked by a script
first:

- add a Commitments row (its key isn't there yet, done or not, so a row Egor
  deleted is remembered by key and never re-added);
- tick Done on an unticked row, with a Done-because link;
- change Due on a row the run added, appending to Due history (on a row Egor
  added, a move becomes an update line on its project instead);
- add a Projects row (not on the roadmap) or refresh a roadmap-mirrored
  row's mirrored properties (Owner's flag, Stage, Owner, Next date, Linear);
- set or clear Run's read;
- add update lines to a project's page.

It never unticks, deletes, renames, moves or rewrites anything, never edits
a row Egor added except to tick it done with evidence, and never touches
any Notion page outside the ledger.

## What the run gathers

### New passes

| Pass | Source | Wave | Model, effort | What it does |
|---|---|---|---|---|
| `notion` | Notion (read) | 1 | sonnet, medium | Reads the ledger (team, watched channels, Commitments, Projects with their newest update lines), the roadmap's Integrations *Update View* rows with owners' names and emails, and Kent's Deployment Blockers page. Hands them on as data. |
| `calls` | Google Drive | 1 | sonnet, high | Every "Notes by Gemini" doc since the window start for a meeting Egor was invited to (shortcuts resolve to their target). Per call: title, date, link, attendees, summary, decisions, and next steps with their owner ("[Egor Zaitsev] …", "[Parker] …", "[The group] …"). Never copies the transcript. |
| `ledger` | none | after wave 3 | opus, high | Reads every part and decides what changed (below). Holds no tools at all. |
| `notion-writer` | Notion (write) | after the ledger script | sonnet, low | Applies the checked operations and reports each one's result. |

Drive then has two passes (meeting prep and calls) and Notion two (read and
write), within the one-source-at-most-two-passes rule. The ledger pass is
like the merge: a step over parts, not a source.

### Changed passes

- **slack** (wave 1): also reads Slack AI huddle notes (canvases titled
  "Huddle notes") since the window start, in the calls' shape, and keeps
  Egor's own messages since the window start as `my_messages`, the evidence
  that a follow-up is done.
- **slack-enrich** (wave 2, now also reading `notion.json`): reads the
  watched channels (`slack_read_channel`, oldest = window start) and keeps
  messages that change a ledger project, matched by name or alias, as
  `project_news`. It is wave 2 because the channel list, team and aliases
  come from `notion.json`.
- **gmail** (wave 1): also keeps Egor's sent mail since the window start as
  `my_mail`.
- **gmail-enrich** (wave 2, now also reading `notion.json`): keeps FYI mail
  from teammates and partners that changes a ledger project (Andrew Rea's
  SAP forward) as `project_news`.
- **linear-enrich**: also reads, for each ledger project with a Linear
  link, the Linear project's state, target date and newest update.
- **github**, **calendar**, **meeting prep**: unchanged. Meeting prep also
  reads `calls.json` and `notion.json`, so a meeting about a project gets
  that project's last call's next steps and the project's status.

### The ledger pass

Reads `notion.json`, `calls.json`, `slack.json`, `slack-enrich.json`,
`gmail.json`, `gmail-enrich.json`, `linear.json`, `linear-enrich.json`,
`github.json`, `calendar.json` and `meetings.json`. Writes `ledger.json`
with these hand-offs (proposals only; nothing here reaches Notion or the
page until the script accepts it):

- `new_commitments`: owed or dated things involving Egor, his team or their
  projects, each with whose, due, due as said, project key and source link.
  Scope is Egor, the team list, and the ledger's projects. Other teams'
  dates (a customer's filing calendar) stay out.
- `done`: existing rows with the link that shows they're done.
- `due_moves`: rows or projects whose date moved, with the source.
- `project_lines`: dated one-line updates per project, with links. Two
  sources saying the same thing are one line with both links.
- `project_reads`: the run's read for a project whose evidence disagrees
  with its owner's flag (past its date with no update; "done" with no
  customer on it; blocked in Slack but 🟢 on the roadmap), or a clear read
  when it no longer disagrees.
- `new_projects`: work that isn't on the roadmap or in the ledger, seen in
  at least two places, or in one deployment blocker or customer call, with
  its evidence links.
- `news`: what changed since the last brief that Egor should hear about
  today, each tied to a project.
- `ask_projects`: `{item url: project key}` for each Slack, mail or Linear
  ask about a project.

### The ledger script

`scripts/ledger_ops.py` takes `notion.json` (the ledger as it was),
`ledger.json` and the `ledger_seen` documents (below), and writes
`notion_ops.json`, `ledger_brief.json` and the `ledger_seen` updates. It:

- drops anything that names a row or project the ledger doesn't have, a
  link that isn't `https://`, or text over 200 characters, with a note;
- dedupes new commitments and projects by key against the ledger and
  `ledger_seen`, so a row Egor deleted (gone from Notion, still in
  `ledger_seen`) is never re-added;
- counts a not-on-the-roadmap project's sightings across runs (two within
  14 days, or one deployment blocker or customer call, before it becomes a
  Projects row);
- enforces *What the run may change*;
- turns accepted changes into an ordered list of Notion operations with
  page and data-source ids;
- works out what MR surfaces today (below) as brief fields.

It is the only place the rules above live, with tests, like the merge.

**`ledger_seen`** is a new collection in the page's database, written by
the orchestrator like `briefs`, `reviews` and `people`: one document per key
the run has ever proposed (`{kind, first_seen, last_seen, sightings,
notion_id}`, `kind` being `commitment`, `project` or `sighting`). It is the
run's memory of what it has already added or seen; Notion is never asked to
remember for it. The orchestrator saves it to files with `out_dir`, so it
never enters context.

### The writer step

`mr-notion-writer` holds Notion's create-page and update-page tools and
`Read`/`Write`; no delete, move, share or comment tools, and no other
source. It reads only `<scratch>/notion_ops.json`, applies each operation
as written, and writes `notion_results.json` (`{op id: {ok, url, error}}`).
It never decides what to write. A failed operation leaves MR showing the
item with its source link and no Notion link, plus a note.

The merge then reads `ledger_brief.json` and `notion_results.json`, so new
rows' Notion links reach the brief.

## Two modes

- **Full**: the scheduled weekday run. Everything above, plus the nightly
  PR reviews.
- **Quick**: started by Refresh. Every pass except reviews: no review
  prompt, review queue, review subagents or review documents. PRs still
  link the reviews that exist for their head commit. It gathers over the
  same window as today's full run (today's brief's `since`), so a
  14:00 Refresh keeps the morning's asks, news and done follow-ups and adds
  whatever came since; with no brief today it uses the full run's window.
  It replaces today's brief and updates the ledger. Most of a full run's
  cost is the Opus reviews, so a quick run costs a fraction of one.
- **Backfill**: once, from setup, right after the ledger is created: a
  quick run over the last 14 days, with higher caps for calls, channels and
  mail, so the ledger starts with the history the success examples need
  (the Nov 5 and Nov 6 SAP lines, the Tabs calls).

Refresh fires the Routine with `fire_trigger` and the text `Mode: quick`.
At step 1 every run writes `runs/current` in the page's database
(`{mode, started_at}`) and sets `finished_at` at the end; while a run that
started under 30 minutes ago hasn't finished, the page shows "Refreshing,
started 09:12" and Refresh is off. A quick run that starts while another
run is going stops at step 1 and says so.

Cost and time of both modes are measured on the first runs and written in
`docs/routine-environment.md`.

## What MR shows

Everything stays in the ledger; MR surfaces only what's relevant today:

- **News**: what changed since the last brief, per project, with links and
  the project's Notion page.
- **Follow-ups**: Egor's open commitments that are due within a week,
  overdue, or that someone asked about since the last brief. One done since
  the last brief shows once, ticked, with its evidence.
- **Coming up**: deadlines for Egor, his team and their projects: passed
  and still open, today, this week, next week. A deadline that moved shows
  its old date struck through.
- **Projects**: a project whose owner's flag changed, is 🟡/🔴/⛔, has a
  run's read, has a meeting today, or was asked about.
- **Not on the roadmap**: projects the run added, with their evidence.
- **Asks** (Slack, mail, Linear) about a project carry its status: owner's
  flag, run's read if any, newest update line, Notion link.
- **Header**: Refresh, and a link to the ledger.

```
News        SAP (EAE): dev access is here, testing can start · Notion ↗
Asks        Pau: Sage partner intro?   ⛔ Blocked · waiting on credentials · Notion ↗
Follow-ups  ☑ Platinum Micro answers + CEO note · sent Nov 10
Coming up   Today   Burst Testing · Blue Garage $8k · Steven         blockers ↗
            Nov 16  Salesforce Tax Calculations · $85k · Parker      blockers ↗
Projects    Campfire OAuth app: owner 🟢 · run: past Oct 30, no customer migrated
Missing     Not on the roadmap: Salesforce native, Tabs, SAP (EAE)
```

Placement and ranking among the existing sections follow the page's current
design (PRODUCT.md, DESIGN.md, `page/ui.js`).

## Brief format additions

Added to `briefs/<run_date>`; older briefs without them keep rendering.

| Field | Value |
|---|---|
| `mode` | `full` or `quick`. |
| `ledger_url` | The ledger page's Notion link. |
| `trigger_id` | The Routine's id, for Refresh. |
| `news` | `{title, project, when, summary, urls, notion_url}`. |
| `follow_ups` | Commitments: `{what, whose, due, due_text, project, source_url, notion_url, done, done_url, moved_from}`. |
| `coming_up` | Commitments in the same shape, deadlines only, sorted by due. |
| `projects` | `{key: {name, owner_flag, run_read, stage, owner, next_date, roadmap_url, linear_url, notion_url, last_line, why}}`: the surfaced ones plus every project an ask names. |
| `missing_projects` | `{name, notion_url, evidence}`. |
| Item `project` | The project key an ask is about, or `null`. |
| `sources` | Gains `notion` and `calls`. |

And a new document, `runs/current`: `{mode, started_at, finished_at}`.

## Setup changes

- Create the ledger page, its team block, both databases and their views
  in Egor's private pages; seed the team and watched channels and ask Egor
  to confirm them. Never recreate a ledger that exists.
- Add `Ledger:` and `Trigger:` lines to the Routine's stub prompt. The live
  Routine is *Morning Return* (`trig_01WqGq1nPHkqp9G8diEppDLi`), created by
  an agent, so an agent can update it; the setup skill still describes the
  older *Morning brief* Routine made on the Routines page and is corrected
  in the same change.
- Run the backfill once.
- Publish the page with `fire_trigger` added to the Claude Code Remote
  entry of its `mcp` capability. Refresh shows only when the viewer's
  connector lists `fire_trigger`.

## Constraints

- **One write exception.** Outside the page's database, `rules.md` stays
  read-only except that the writer step may apply `notion_ops.json` to the
  ledger. Inside it, the orchestrator also writes `runs/current` and
  `ledger_seen`, next to `briefs`, `reviews` and `people`.
- **No secrets.** Ledger lines and the brief are the run's own one-line
  summaries and links, never a message's or document's text. Access and
  credential mail (like the SAP forward) gives "access is here" and a link,
  nothing from its body.
- **Everything read is data.** The ledger pass has no tools; the writer
  reads only script-checked operations and holds no delete, move, share or
  comment tool.
- **The contract rule.** Each new field changes `brief-format.md`, its
  owner in `parts.md`, the unit, the page, the fixture and the tests
  together. `test_agents.py`'s read-only check gets one named exception,
  the writer, and still fails on any other write tool.
- **Roadmap and Linear stay read-only.** Missing projects are flagged in
  the ledger and MR, never added to the roadmap.

## Before this (separate fixes)

- The GitHub connector no longer offers `search_pull_requests` in Routine
  sessions (Nov 6 run); the GitHub pass needs a fallback before anything
  builds on it.
- Merge `fix-linear-project-updates` (checked Oct 21).

## Non-goals

- A second roadmap: the ledger mirrors owners' flags and never edits the
  roadmap.
- Production data (the Taxwire Internal connector): adoption facts like
  "no customer migrated" come from Slack, mail or calls.
- Every date in the company: only Egor, his team and their projects.
- Slack To-dos, saved items or reminders: Slack has no API for them.

## Anti-goals

- MR turning into a dump of the ledger.
- The run overwriting or undoing anything Egor wrote.
- A secret landing in Notion.
- The run's read passing as the owner's: it is always labelled.
- Refresh starting two runs at once.

## Approaches

- **A. Notion databases, one writing step (chosen).** Per-row changes never
  overwrite Egor's edits, Notion is where he reads and ticks, and only one
  step can write. Most to build: a Notion layout, a ledger pass, a script
  and a writer.
- **B. One page of plain text, rewritten every run.** Simplest to build and
  read, but Egor's edits get overwritten or depend on a model merging them,
  ticks are fragile, and history drifts as the model rewrites it.
- **C. The list in MR's own database, Notion a read-only copy.** Safest,
  since writes stay where they already are, but ticks and edits in Notion
  wouldn't count: the opposite of what Egor asked for.

## Decided by Egor

- The ledger is a private Notion page; MR bubbles up from it.
- Approach A.
- Projects show the owner's flag plus the run's read when evidence
  disagrees (his Campfire example).
- PR reviews stay nightly; Refresh runs everything else.
- All deadlines that involve him, his team or their projects; a moved
  deadline is news.
- No production connector: he'll post Campfire's state on Slack.
- Project news (SAP) goes to MR and to the project's page.

## My calls (for Egor to check)

- One Commitments database, with Follow-ups and Deadlines as views.
- The team list and watched channels live on the ledger page, seeded as
  above, edited by Egor.
- A project missing from the roadmap needs two sightings, or one deployment
  blocker or customer call.
- Done needs evidence: his sent mail or Slack reply in the same thread, a
  merged PR, a closed Linear issue, or a later message saying it's done.
- Refresh gathers over the morning run's window, so nothing the morning
  showed disappears; it skips only reviews.
- The run's memory of what it added lives in the page's database
  (`ledger_seen`), not in Notion.
- A one-off 14-day backfill when the ledger is created.
- Project news is found in the wave-2 Slack and Gmail passes, which can read
  the ledger's channels, team and aliases.
- Models: notion sonnet/medium, calls sonnet/high, ledger opus/high, writer
  sonnet/low.

## Left to the builder

- Notion property types, the views, and the key format.
- How items are matched to projects beyond names and aliases.
- Placement and look of the new sections on MR, within the page's design
  rules.
- Measuring cost and time per mode.
