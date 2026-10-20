# Parts

The run is a set of passes. Each pass holds one source's tools, reads the
parts named in its Reads column (and nothing else), and writes one part file
to `<scratch>/parts/<part>.json`. The orchestrator starts each wave's passes
together. `scripts/merge_brief.py` turns the parts into the brief, and it is
the only thing that turns a hand-off into a brief field.

A part owns the brief Fields and `sources` entries in its row and no others.
Hand-offs are data for later passes and the merge; they never reach the page
as they are.

## Passes

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

Wave 0 is the orchestrator's own work before any pass starts. `reviews.json`
is written by the review scripts, and `merge` owns the fields it derives from
hand-offs.

## Reviews

Review subagents aren't parts: each writes one review's markdown, which
`scripts/review_doc.py` turns into a `reviews` document.

| Pass | Unit | Tools | Model | Effort |
|---|---|---|---|---|
| review | reviews.md | github | opus | xhigh |

A review subagent also gets `Bash`, for read-only git in its worktree; its
`github` tools are only for the diff-only fallback.

## Keys

- `pr_key` is `owner/repo#number`.
- `meeting_key` is the Meeting's `url`: the calendar event's link, or for an
  invite that isn't on the calendar, the invite's view link.

## Part files

Every part file is one JSON object:

```json
{"sources": {}, "fields": {}, "notes": [], "handoffs": {}}
```

`sources` and `fields` hold only what the part owns, in the brief format's
shapes. `notes` are sentences for the brief's notes. `handoffs` hold only the
part's hand-offs, in the shapes below. A key the part doesn't own is an error.

## Hand-offs

- `repos`: `[{repo, clone}]`, each repo searched and the clone URL `add_repo` gave.
- `pr_keys`: `[{key, url, title, head_ref, author}]`, every PR in the part's fields.
- `commit_identities`: `{login: [{name, email}]}`, the author names and emails on each PR author's and requested reviewer's commits (`get_commits`).
- `branches`: `[{repo, branch, finished}]`, one per repo and branch, from the most recently updated matching session.
- `pr_links`: `[{url, pr: {repo, number}, from_email, to_me, when, line}]`, PR links in the Slack messages the base pass read; `line` is one short sentence saying who mentioned it where.
- `ask_senders`: `{item url: email}`, the teammate or guest who asked, for each Slack ask.
- `seen`: `[permalink]`, every Slack message the base pass read.
- `invites`: Meetings for invites to events today, with `on_calendar: false` and `context` and `action` `null`.
- `senders`: `{item url: email}`, the sender of each mail ask.
- `events`: Meetings from my calendar, with `context` and `action` `null`.
- `meeting_keys`: `[{key, title, start, attendees, external_domains, recurring}]`, one per meeting in `events`; `attendees` are emails.
- `ooo_names`: `[name]`, the people the Taxwire OOO calendar names.
- `linear_names`: `[name]`, the Linear people the part names without an email.
- `pr_mentions`: Items, each with four more keys: `pr: {repo, number}`, `from_email`, `to_me`, `line`.
- `meeting_threads`: `{meeting_key: [{url, when, who, summary}]}`.
- `names`: `{name: email | null}`, teammates matched in Slack by name.
- `people_profiles`: `{email: {name, photo_url}}`, from Slack profiles.
- `issues`: `{identifier: {title, url, status, pr_urls}}`.
- `pr_states`: `{pr url: "open" | "merged" | "closed"}`.
- `review_ids`: `{pr_key: review id}`.
- `queued`: the number of reviews left for the next run.
- `prompt`: `"live"` when reviews used `/pr-review`'s prompt, otherwise `"copy: <why>"`.

## Tools

A pass holds only its source's tools, plus `Read`, `Grep`, `Glob`, `Write`
and `ToolSearch`.

| Source | Tools |
|---|---|
| github | `search_pull_requests`, `pull_request_read`, `get_file_contents`, `add_repo`, `list_repos` |
| sessions | `list_sessions`, `get_session`, `list_environments` |
| slack | `slack_search_public_and_private`, `slack_read_thread`, `slack_read_channel`, `slack_get_reactions`, `slack_search_users`, `slack_read_user_profile` |
| gmail | `search_threads`, `get_thread` |
| calendar | `list_calendars`, `list_events` |
| linear | `get_user`, `get_notifications`, `get_issue`, `list_comments`, `list_issues` |
| drive | `search_files`, `read_file_content` |
