# GitHub, base pass (`sources.github`)

Fills `my_prs`, `review_prs`, `team_review_prs` and `stale_closed`.

## Repos

If this session has `list_repos` and `add_repo`: `list_repos` with
`query: "taxwire/"` and `limit: 200`, keep the `taxwire/*` repos whose last
push is within the last 30 days, and `add_repo` each one with
`access: "read"`. A repo it refuses goes in `notes` and is skipped. Each repo
and the clone URL `add_repo` gave go in the `repos` hand-off. If this session
doesn't have them, use the repositories already attached to this session.
Every GitHub search below covers only these repos: split them into groups so
each query, with its `repo:owner/name` qualifiers, stays under 250
characters, run the search once per group, and merge the results.

## Pull requests

Five searches with `search_pull_requests` (`perPage: 100`):

1. `is:open author:{{GITHUB_LOGIN}}` — my open PRs → `my_prs`.
2. `is:open author:{{GITHUB_LOGIN}} label:stale` — those of them the stale bot
   labelled.
3. `is:closed is:unmerged author:{{GITHUB_LOGIN}} label:stale closed:>=<run_date − 7 days>` → `stale_closed`.
4. `is:open user-review-requested:{{GITHUB_LOGIN}}` — my review requested by
   name → `review_prs`.
5. `is:open review-requested:{{GITHUB_LOGIN}} -user-review-requested:{{GITHUB_LOGIN}}`
   — only my teams requested → `team_review_prs`.

For each PR from searches 1 and 4, call `pull_request_read`:

- `get` → `draft`, `mergeable_state` (as returned, never translated),
  `head.sha`, `head.ref` → `head_ref`, `base.ref` → `base_ref`, `additions`,
  `deletions`, `changed_files`, `created_at`, `updated_at`,
  `requested_reviewers`, `body`.
- `get_status` and `get_check_runs` → `ci`. Count the combined status only
  when its `total_count` is above 0. `failure` if the status `state` is
  `failure` or `error`, or any check run's `conclusion` is `failure`,
  `timed_out`, `cancelled`, `action_required` or `startup_failure`. Else
  `pending` if the status `state` is `pending` or any check run's `status` isn't
  `completed`. Else `success` if there was any status or check run. Else `none`.
  With `failure`, `failing_check` is the first failing check run's `name` and
  `details_url` (or the failing status's `context` and `target_url`).
- `get_reviews` → `review_decision`. Take each reviewer's latest review that
  isn't `COMMENTED`. Any `CHANGES_REQUESTED` gives `CHANGES_REQUESTED`.
  Otherwise any `APPROVED` gives `APPROVED`. Otherwise `REVIEW_REQUIRED` if
  `requested_reviewers` isn't empty, else `null`.
- `get_review_comments` → `unresolved_threads`: the number of review threads
  with `is_resolved: false` (follow `pageInfo` to the end), and
  `first_unresolved_url`, the first such thread's first comment `html_url`.
- `get_files` (all pages) → `reviewable_additions` and `reviewable_deletions`:
  the sums over files the brief format's reviewable-lines rule keeps.
- `get_commits` → for the PR's author and each requested reviewer who has
  commits on it, every distinct author `name` and `email` on their commits,
  into `commit_identities` under their login.

For each PR from search 5, call only `get`; set `ci`, `review_decision`,
`unresolved_threads`, `reviewable_additions` and `reviewable_deletions` to
`null`.

Then: `waiting_since` is the PR's `created_at`. A PR in `my_prs` that search 2
also found gets `stale: true` and `stale_closes_on` = its `updated_at` date + 7
days; every other PR gets `stale: false` and `stale_closes_on: null`.
`linear_id` is the first Linear identifier (`[A-Z]+-\d+`, a team key Linear
knows) in the branch name, then the title, then a `Closes`, `Fixes`, `Part of`
or `Linear:` line in the body; otherwise `null`. `author_email`, each
reviewer's `email`, `blocking_signal` and `review_id` are `null`: the merge
fills them. Every PR in the four lists also goes in `pr_keys`.

## Output

Write `github.json`. Reads no other part.
