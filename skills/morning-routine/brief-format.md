## Brief format

The page reads two collections in its database. Write them exactly as below:
the page ranks and renders whatever is there, and it trusts these field names.
Omit nothing. A list with nothing in it is `[]`, an unknown value is `null`.
Times are ISO 8601 with a timezone; dates are `YYYY-MM-DD`.

### `briefs/<run_date>` — one document per run

The document id is the run date in the user's timezone (`2026-10-20`). A second
run on the same day replaces it.

| Field | Value |
|---|---|
| `run_date` | The document id. |
| `generated_at` | When this run finished gathering (UTC). The next run reads it as "since". |
| `timezone` | The IANA timezone the run used. |
| `sources` | `{github, sessions, slack, gmail, calendar}`, each `{"ok": true}` or `{"ok": false, "error": "<one line>"}`. A source that failed still gets its lists, as `[]`. |
| `today` | `{summary, events, prep}`: `summary` is one sentence about the shape of the day; `events` are today's events as `{title, start, end, url}`; `prep` is a list of Items for tomorrow's meetings worth preparing for. |
| `review_prs` | PRs where my review was requested by name. |
| `team_review_prs` | PRs where only one of my teams was requested. Never reviewed. |
| `my_prs` | My open PRs, drafts included. |
| `stale_closed` | My PRs the stale bot closed in the last 7 days: `{repo, number, title, url, closed_at}`. |
| `slack_asks` | Items: Slack messages asking me something I haven't answered or reacted to. |
| `slack_discussions` | Items: Slack threads worth knowing about. |
| `mail_asks` | Items: mail threads asking me something I haven't replied to. |
| `notes` | Short strings about the run itself: reviews queued for the next run, a repo that couldn't be attached, anything doubtful. |

**PR** — every entry in `review_prs`, `team_review_prs` and `my_prs`:

| Field | Value |
|---|---|
| `repo` | `owner/name`. |
| `number`, `title`, `url`, `author` | As GitHub reports them; `author` is the login. |
| `draft` | `true` or `false`. |
| `head_sha` | The PR's current head commit, full 40 characters. |
| `mergeable_state` | GitHub's value as returned: `clean`, `has_hooks`, `dirty`, `blocked`, `behind`, `unstable`, `unknown`, `draft`, or `null`. Never translate it. |
| `ci` | `success`, `failure`, `pending`, or `none` (no statuses and no check runs). |
| `review_decision` | `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or `null`. |
| `unresolved_threads` | Number of unresolved review threads. |
| `additions`, `deletions`, `changed_files` | Numbers from GitHub. |
| `created_at` | When the PR was opened. |
| `waiting_since` | For review requests: when it started waiting on me (the PR's `created_at`). Otherwise the same as `created_at`. |
| `stale` | `true` when the PR carries the `stale` label. |
| `stale_closes_on` | For a stale PR, the date the bot will close it (its `updated_at` + 7 days); otherwise `null`. |
| `blocking_signal` | For a review request whose author is waiting on me (pinged me about it in Slack, or it fixes something live), one short line saying so; otherwise `null`. |
| `review_id` | The id of this PR's document in `reviews` for its current `head_sha`, if one exists; otherwise `null`. |

**Item** — every entry in `today.prep`, `slack_asks`, `slack_discussions` and
`mail_asks`: `{title, url, who, when, summary}`. `title` is at most ten words,
in my words, never a subject line copied in. `url` is the `https://` link to the
message or thread, or `null`. `who` is the person as I'd name them. `when` is the
message's time. `summary` is one sentence: what they want or what happened.

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
