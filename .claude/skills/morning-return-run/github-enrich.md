# GitHub, enrichment pass

Finds the state of PRs that Linear issues link to but that aren't open in
the brief, so the page can name a feature's merged and closed PRs too.

Each URL in `linear-enrich.json`'s `issues` (`pr_urls`) that isn't the `url`
of a PR in `github.json`'s `pr_keys`: `pull_request_read` `get` on it. Its
state goes in `pr_states` under the URL: `merged` when `merged` is true,
`closed` when it's closed and not merged, `open` otherwise. A PR that can't be
read is left out.

## Output

Write `github-enrich.json`. Reads `github.json` and `linear-enrich.json`.
