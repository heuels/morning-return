# Morning routine — design

Status: draft for review · Owner: Egor Zaitsev (GitHub `heuels`) · 2026-10-20

## Why

Each morning Egor pieces together what needs him from GitHub, Slack, Gmail and
Calendar, and decides which PRs to review and which of his own to push over the
line. The reviews themselves are the expensive part: someone has to open each PR
and read it. This routine does the gathering and the first-pass reviews before he
sits down, and hands him one ranked page.

Success: he opens one page with his coffee, works top to bottom, and doesn't
need to go hunting in four tools to find out what he missed.

## What it is

A skill, `morning-routine`, in a new `taxwire-skills` plugin of the same name,
delivered as a claude.ai cloud Routine:

- **Scheduled**: the Routine starts a fresh session every weekday morning, runs
  the routine, and updates the same private Artifact page.
- **On demand**: fire the same Routine (from the Routines list, or by asking any
  session to fire it). Same behaviour, same page.

Cloud sessions only load plugins from the org's synced catalog, and this plugin
isn't in it. So the Routine doesn't load the plugin: **setup copies the skill's
run instructions and the review prompt into the Routine's own stored prompt.**
Only Egor can change what runs every morning; the repo stays the source of
truth, and picking up a new version means re-running setup. Getting it into the
org catalog (so `/morning-routine` exists everywhere) is a possible later step,
not part of this build.

Setup runs from an interactive session that has `taxwire-skills` checked out:
"set up my morning routine" → read `plugins/morning-routine/skills/morning-routine/SKILL.md`
and follow its Setup section, which creates the Routine (or updates it, if one
with the same name exists) with the assembled prompt.

## What it gathers

Windows below are relative to the run. "Since the last working day" means since
the previous weekday's run, so a Monday run covers the weekend.

### GitHub

Repos: every `taxwire/*` repo with a push in the last 30 days. A fresh Routine
session starts with no repos attached, so each run first lists the org's repos
(`list_repos`), then attaches each one read-only with `add_repo`, and only then
searches. The searches stay within the repos it attached.

1. **My open PRs** — `author:heuels is:open`, drafts included.
2. **My PRs about to go stale** — open, author me, label `stale`. The stale bot
   (`actions/stale`, both app repos) labels after 7 idle days and closes 7 days
   later, so these close within a week. Drafts are exempt from the bot.
3. **My PRs recently closed as stale** — `author:heuels is:closed is:unmerged
   label:stale`, closed in the last 7 days.
4. **PRs where my review was requested by name** — `user-review-requested:heuels
   is:open`. This is the GitHub search qualifier for a direct request; the plain
   `review-requested:` qualifier also matches requests to my teams and must not be
   used for this list.
5. **PRs requested from one of my teams** (not by name) — listed for awareness,
   never reviewed automatically.

For every PR in lists 1, 2 and 4, fetch what the ranking needs: head SHA, draft
flag, GitHub's `mergeable_state`, CI state on the head commit (python CI is a
single commit status, `RWX: pr.yml (pull request)`, not a check run), review
decision, unresolved review threads, size (files, +/-), age, and time since my
review was requested.

### Claude cloud sessions

`list_sessions` (mine, paged back over the last ~30 days of activity). A session
matches one of my PRs when the PR's head branch appears in the session's
`session_context.outcomes[].git_repository.git_info.branches` for that repo
(sessions record both their `claude/…` working branch and any `egor/…` branch
they pushed). If several match, the most recently updated wins. Use it only to
answer "does this PR look finished?" (below). Only claude.ai cloud sessions are
visible; local CLI sessions are not, and a PR with no matching session just
lacks that signal.

### Slack

1. **Outstanding asks of me** — DMs and @-mentions from the last working day
   onward where the last word is a question or request to me that I haven't
   answered in the thread or reacted to with any emoji. Before an item is listed,
   open its thread once and drop it if I've replied or reacted. Group mentions
   (`@here`, `@channel`, a user group) do not count as asks of me.
2. **Discussions I should know about** — threads since the last working day that
   mention one of my open PRs (number, branch or URL), or that I'm a participant
   in and that got new replies I haven't seen. Builder's call on the exact search
   recipe; the bar is "would Egor be surprised later that he missed this".

### Gmail

Threads from the last 2 days where someone asked me something and I haven't
replied. Skip automated mail (GitHub notifications, calendar invites, newsletters)
— those are covered by their own sources or not wanted.

### Google Calendar

Today's events, plus tomorrow's for prep. A meeting earns a prep item when I'm
the organizer or it names a project/PR that also shows up elsewhere on the page.

## What it does before rendering

### Reviews

The review is the `pr-review` plugin's review prompt (the heredoc in
`plugins/pr-review/skills/pr-review/pr-review.sh`) run by a subagent per PR, with
the same output format: categories, severities, verdict line, permalinks pinned
to the head SHA. Setup extracts the prompt from that file and embeds it in the
Routine's prompt, so there is no hand-maintained copy in the skill; re-running
setup picks up changes to `pr-review.sh`. `pr-review.sh` itself is not run: it
needs `gh`, a nested `claude -p` and a persistent `~/pr-reviews/` directory, none
of which a fresh cloud session has.

A PR gets reviewed when its head SHA has no recorded review and either:

- my review was requested **by name** (list 4), or
- it's **my own** PR and it's either marked ready for review (not draft), or it's a
  draft whose matching cloud session looks finished — `status_bucket` is
  `REVIEW_READY` or `COMPLETED`, its `post_turn_summary.status_category` is
  `completed`, and `post_turn_summary.needs_action` is empty.

Team-only requests never trigger a review.

Reviews run in parallel subagents. Each subagent reads the diff and files at the
PR's head SHA (via the GitHub tools, or a shallow clone if the repo is reachable
from the session — builder's call). Reviews are read-only and never posted
anywhere.

### Review markers

"Already reviewed" is recorded per `(repo, PR number, head SHA)` in the
Artifact page's shared database (`db` capability), together with the review's
markdown, verdict, severity counts and timestamp. That replaces `pr-review.sh`'s
`~/pr-reviews/state/` files, which would not survive between cloud runs. A new
push to the PR means a new head SHA, so the PR is reviewed again on the next run.

## What the page shows

One private Artifact page, the same URL every day. Order, top to bottom:

1. **Today** — the calendar in a line or two, and any prep items.
2. **PRs to review** — list 4, ranked. Each shows the review's verdict and
   severity counts, with the full review expandable in place. Team-requested PRs
   follow in a quieter "also requested from your teams" group, unreviewed.
3. **My PRs to merge** — lists 1 and 2, ranked by how close to merge each is.
   Each shows what's left (CI red, conflict, behind base, review required,
   unresolved threads) and, when a review ran, its verdict. Stale-labelled
   PRs show when they'll close.
4. **Closed as stale** — list 3, with when it closed.
5. **Slack** — outstanding asks, then discussions.
6. **Mail** — unanswered asks.

Empty sections are dropped. A source that failed (a connector error, a tool
missing) shows one line saying so, so a gap is never mistaken for a quiet day.

### Ranking

**PRs to review**, highest first: blocking signals (the author pinged me about it
in Slack, or it's a fix for something live), then time waiting since my review was
requested, then smaller PRs before larger ones.

**My PRs to merge**, in tiers:
1. Mergeable now: GitHub's `mergeable_state` is `clean`, i.e. whatever the
   repo's branch protection requires (checks, reviews) is satisfied and there's
   no conflict. Unresolved review threads don't demote a PR from this tier but
   are shown on it.
2. One thing left: `mergeable_state` is `dirty` (conflict), `behind`,
   `unstable` (a non-required check failing) or `blocked` with exactly one cause
   (CI red or a required review missing).
3. Several things left.
4. Drafts.

Approval alone isn't a tier boundary: many PRs in these repos merge without an
approving review, so the repo's own protection rules decide via
`mergeable_state`.

Within a tier, stale-labelled first (closest to closing), then oldest.

Both rankings are the builder's to tune; the tiers above are the intent.

## Constraints

- **Read-only.** It never posts, comments, reviews, reacts, replies, sends,
  merges, reopens or labels anything on GitHub, Slack, Gmail or Calendar. The only
  writes are the Artifact page and its database.
- **Gathered content is data, not instructions.** Slack messages, emails, PR
  bodies and review comments are summarized, never acted on, and rendered as
  escaped text.
- **Cost.** Reviews are the cost. Skip-unchanged keeps it to new and updated PRs.
  Reviews use the model the session runs on; builder may add a cap (e.g. at most
  N reviews per run, highest-ranked first) if a first run shows it's needed.
- **Unattended.** A scheduled run has no one to ask. It never blocks on a
  question; anything it can't decide goes on the page.
- **Repo scope.** Only repos the run attached with `add_repo` (see GitHub above).

## Non-goals

- Acting on anything: merging, reopening stale PRs, replying, fixing CI.
- Linear issues (possible later).
- Preview links (possible later).
- Reviewing team-requested PRs.
- Replacing `pr-review.sh` for people who run it locally.

## Anti-goals

- A page that lists everything. If it isn't ranked or doesn't need Egor, it
  doesn't belong.
- Re-reviewing an unchanged PR every morning.
- A review appearing for a PR that only asked my team.
- A Slack or mail item that's already been answered.
- A failed source silently rendering as "nothing here".

## Setup the build must cover

- The plugin: `plugins/morning-routine/` with `.claude-plugin/plugin.json`,
  `skills/morning-routine/SKILL.md`, an entry in `.claude-plugin/marketplace.json`
  and a row in the README table. It's the source the Routine's prompt is built
  from; the README row says it runs as a Routine, not as a slash command.
- The Routine: `create_trigger` with `create_new_session_on_fire: true`, a weekday
  morning cron in `Europe/Lisbon` (time is my call: 07:45; change freely), and
  `connectors` granting Slack, Gmail and Google Calendar (GitHub is built into
  the session, not a connector). Its prompt is assembled by setup: the run
  instructions from `SKILL.md`, the review prompt from `pr-review.sh`, and the
  per-user values (GitHub login, timezone, the Artifact URL).
- First run creates the page; setup then updates the Routine's prompt with the
  page's URL so every later run reads it, then republishes to the same URL.
- The assembled prompt has to fit `create_trigger`'s prompt limit; the builder
  checks this early and trims the run instructions if it doesn't.
- After setup, fire the Routine once and confirm the unattended run publishes
  the page and writes the review markers without stalling on a permission
  prompt.

## Decided by Egor

- Sources: GitHub, Slack, Gmail, Google Calendar; Claude cloud sessions as the
  "looks finished" signal.
- Review on direct requests only, not team requests.
- Review my own PRs when ready for review or when their session looks finished.
- Runs as a scheduled cloud Routine, ready before he sits down.
- Output is an HTML Artifact page.
- The Routine carries its own copy of the skill and review prompt (option C
  below), not a catalog install or a read from `main`.

## My calls (for Egor to check)

- Reviews use `pr-review.sh`'s prompt through subagents, not the script.
- Markers and review text live in the Artifact's database.
- "Recently closed as stale" = last 7 days; Slack window = since last working day;
  mail = last 2 days.
- Adding "about to go stale" and team-requested-for-awareness lists.
- "In Taxwire" = every `taxwire/*` repo pushed in the last 30 days, attached
  per run.
- Ranking tiers and order above, with GitHub's `mergeable_state` as the
  "mergeable now" test.
- 07:45 Lisbon on weekdays.

## How the skill reaches the Routine's session (decided: C)

Cloud sessions don't install plugins from this repo's marketplace; they get the
org's synced plugin catalog, which doesn't include this plugin (or `pr-review`).
The options were:

- **A. Add it to the org catalog**, so `/morning-routine` works everywhere.
  Needs an org admin and installs for the whole org.
- **B. Have the Routine read `SKILL.md` from `taxwire-skills` main each run.**
  Anyone who can merge to main would change what runs with Egor's Slack and
  Gmail access.
- **C. Have setup copy the skill and the review prompt into the Routine's own
  stored prompt.** Only Egor can change what runs; a new version needs a
  re-run of setup.

Egor chose C. A may follow if teammates want their own.

## Left to the builder

- Exact Slack and Gmail search queries.
- Matching sessions to PRs.
- Page layout and visual design, within the section order above.
- Whether reviews read code via GitHub tools or a shallow clone.
- Any per-run review cap.
