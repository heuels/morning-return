## Brief format

The page reads three collections in its database. Write them exactly as below:
the page ranks and renders whatever is there, and it trusts these field names.
Omit nothing. A list with nothing in it is `[]`, an unknown value is `null`.
Times are ISO 8601 with a timezone; dates are `YYYY-MM-DD`; clock times the
page shows as written (`by`) are `HH:MM` in my timezone.

### `briefs/<run_date>` — one document per run

The document id is the run date in my timezone (`2026-10-20`). A second run on
the same day replaces it.

| Field | Value |
|---|---|
| `run_date` | The document id. |
| `generated_at` | When this run finished gathering (UTC). |
| `since` | The previous brief's `generated_at`, or `null` on the first run. |
| `login` | My GitHub login. |
| `environment` | The cloud environment this run is in, as `{id, name}` (from `get_session`). Sessions started from the page run there. |
| `page_url` | This page's claude.ai link. Sessions started from the page read reviews through it. |
| `timezone` | The IANA timezone the run used. |
| `sources` | `{github, sessions, slack, gmail, calendar, linear}`, each `{"ok": true}` or `{"ok": false, "error": "<one line>"}`. A source that failed still gets its lists, as `[]`. The page never shows `sessions`; it only decides which PRs get reviewed. |
| `meetings` | Today's meetings, Meeting records, including invites found only in mail. |
| `day_blocks` | My availability calendar's blocks for today, as `{kind, start, end}` with `kind` one of `focus`, `lunch`, `unavailable`. That calendar mirrors work and personal events alike, so these only draw the day; never call one a clash. |
| `out_of_office` | Teammates out in the next seven days, from the Taxwire OOO calendar: `{email, name, start, end}`, dates as `YYYY-MM-DD` with `end` exclusive, the way all-day events store them. |
| `review_prs` | PRs where my review was requested by name. |
| `team_review_prs` | PRs where only one of my teams was requested. Never reviewed. |
| `my_prs` | My open PRs, drafts included. |
| `stale_closed` | My PRs the stale bot closed in the last 7 days: `{repo, number, title, url, closed_at}`. |
| `slack_asks` | Items: Slack messages asking me something I haven't answered or reacted to. |
| `slack_discussions` | Items: Slack threads worth knowing about. |
| `mail_asks` | Items: mail threads asking me something I haven't replied to. |
| `linear_asks` | Items: Linear comments asking me something I haven't answered (the newest comment on the thread isn't mine). |
| `linear` | `{assigned, project_updates, stale}`, below. |
| `linear_issues` | Every Linear issue a PR in the brief points at, by identifier: `{title, url, status, prs}`, `prs` being each PR attached to the issue as `{repo, number, url, state}` with `state` `open`, `merged` or `closed`. |
| `notes` | Short sentences about the run itself: reviews queued for the next run, a repo that couldn't be attached, anything doubtful. |

**Meeting** — every entry in `meetings`:

| Field | Value |
|---|---|
| `title` | As on the calendar or the invite, unless it says nothing about the meeting (a booking page's "30 minutes meeting"): then a short title naming the organisation and purpose. |
| `start`, `end` | ISO times. |
| `url` | The event's calendar link. For an invite that isn't on my calendar, the invite's "view event" link, where accepting adds it. |
| `conference` | `meet`, `teams`, `zoom`, `phone`, or `null`. |
| `on_calendar` | `false` for an invite found in mail but missing from my calendar; otherwise `true`. The page marks these in red and makes adding it the action. |
| `kind` | `customer`, `prospect`, `partner`, `internal`, `prep`, or `other`. |
| `org` | The outside organisation, or `null` for internal meetings. |
| `attendees` | Everyone but me: `{email, name, org, organizer, optional}`. `org` is `"Taxwire"` for teammates. |
| `context` | One or two sentences: what the meeting is for, what came out of earlier calls, and why I'm there. Taken from mail, Slack and shared docs; `null` when there's nothing to add. |
| `action` | What to do this morning to be ready, as an Action, or `null` when there's nothing to prepare. |

**Action** — `{verb, url, by}`: `verb` is one or two words naming the step
("Read brief", "Reply Bryan", "Prep Hubs"); `url` is the `https://` link that
starts it, or `null`; `by` is the `HH:MM` it's needed by, or `null`.

**PR** — every entry in `review_prs`, `team_review_prs` and `my_prs`:

| Field | Value |
|---|---|
| `repo` | `owner/name`. |
| `number`, `title`, `url`, `author` | As GitHub reports them; `author` is the login. |
| `author_email` | The author's Taxwire email when the run matched them to a teammate (by their commits' author name and email, then Slack); otherwise `null`. |
| `draft` | `true` or `false`. |
| `head_sha` | The PR's current head commit, full 40 characters. |
| `head_ref`, `base_ref` | The PR's branch and the branch it merges into. Stacked PRs are found by following these. |
| `mergeable_state` | GitHub's value as returned: `clean`, `has_hooks`, `dirty`, `blocked`, `behind`, `unstable`, `unknown`, `draft`, or `null`. Never translate it. |
| `ci` | `success`, `failure`, `pending`, or `none` (no statuses and no check runs). `null` in `team_review_prs`, which aren't fetched in full. |
| `failing_check` | When `ci` is `failure`: `{name, url}` of the first failing check run or status, `url` being its `details_url`/`target_url`. Otherwise `null`. |
| `review_decision` | `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or `null` (also in `team_review_prs`). |
| `unresolved_threads` | Number of unresolved review threads; `null` in `team_review_prs`. |
| `first_unresolved_url` | The `html_url` of the first comment in the first unresolved thread, or `null`. |
| `additions`, `deletions`, `changed_files` | Numbers from GitHub. |
| `reviewable_additions`, `reviewable_deletions` | The same counts without test files and lockfiles (see below); `null` in `team_review_prs`. |
| `created_at` | When the PR was opened. |
| `waiting_since` | For review requests: when it started waiting on me (the PR's `created_at`). Otherwise the same as `created_at`. |
| `stale` | `true` when the PR carries the `stale` label. |
| `stale_closes_on` | For a stale PR, the date the bot will close it (its `updated_at` + 7 days); otherwise `null`. |
| `blocking_signal` | For a review request whose author is waiting on me (pinged me about it in Slack, or it fixes something live), one short line saying so; otherwise `null`. |
| `review_id` | The id of this PR's document in `reviews` for its current `head_sha`, if one exists; otherwise `null`. |
| `linear_id` | The Linear issue this PR belongs to (`DATA-1440`), from the branch name, the title or a `Closes`/`Part of` line in the body; otherwise `null`. |
| `requested_reviewers` | Reviewers still requested, as `{login, email}`, `email` matched the same way as `author_email` or `null`. |

Reviewable lines leave out a file when any path segment is `tests`,
`__tests__` or `__mocks__`, or the file name is `conftest.py`, `test_*.py`,
`*_test.py`, `*.test.*`, `*.spec.*`, `*.snap`, or a lockfile (`uv.lock`,
`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`).

**Item** — every entry in `slack_asks`, `slack_discussions` and `mail_asks`:

| Field | Value |
|---|---|
| `title` | At most ten words, in my words, never a subject line copied in. |
| `url` | The `https://` link to the message or thread, or `null`. |
| `people` | Taxwire teammates involved, as emails (each has a `people` document). |
| `who` | Everyone else involved, as text: `"Bryan Pikal · PowerPusher"`; or `null`. |
| `when` | The message's time. |
| `summary` | One sentence: what they want or what happened. |
| `tag` | A short label tying it to something today (`"PowerPusher 17:30"`), or `null`. |
| `action` | An Action when there's something specific to do ("Reply", "Point to #4254"); otherwise `null`. |

**Linear** — what `linear` holds, all for the signed-in Linear user:

| Field | Value |
|---|---|
| `assigned` | Issues assigned to me since the previous brief (on the first run, those whose assignment notification is unread) that I haven't started: `{id, title, url, by, when, priority, project}`, `by` being the assigner's email, `priority` Linear's name for it (`Urgent`, `High`, …) or `null`. |
| `project_updates` | Projects I lead whose update is overdue: `{name, url, due}`. |
| `stale` | My issues in a started state with no update in 14 days and no open PR: `{id, title, url, status, updated_at}`. |

### `people/<email>` — one document per teammate

Every teammate the brief names (`author_email`, attendees with `org`
`"Taxwire"`, an Item's `people`) needs one, so each appears with a photo and a
name. Write it when it's missing or more than 30 days old; leave it otherwise.

| Field | Value |
|---|---|
| `name` | Their full name from Slack. |
| `org` | `"Taxwire"`. |
| `photo` | Their Slack profile photo, cropped square and scaled to 64×64, as a `data:image/jpeg;base64,…` URI. `null` when they have none. |
| `updated_at` | When this run wrote it. |

### `reviews/<owner>:<repo>:<number>:<head_sha>` — one document per review

Written once per PR head commit; its existence is how the next run knows that
commit is already reviewed. Never rewrite one.

| Field | Value |
|---|---|
| `repo`, `number`, `head_sha` | The reviewed PR and commit. |
| `reviewed_at` | When the review finished. |
| `verdict` | From the review's Summary: `blocking`, `needs-work`, `minor`, or `ship-ready`. |
| `counts` | `{critical, high, medium, low}` from the review's Totals line. |
| `markdown` | The review exactly as the reviewer produced it. |
