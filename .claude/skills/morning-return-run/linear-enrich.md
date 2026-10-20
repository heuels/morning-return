# Linear, enrichment pass

Finds the Linear issue behind each PR, so the page can group a feature's
PRs under it.

For each distinct `linear_id` on a PR in `github.json`'s fields: `get_issue`
with its attachments. Under the identifier in `issues`: the issue's `title`,
`url` and `status`, and `pr_urls`, the URL of each GitHub pull request among
its attachments (`https://github.com/<owner>/<repo>/pull/<number>`). An
identifier Linear doesn't know is left out.

## Output

Write `linear-enrich.json`. Reads `github.json`.
