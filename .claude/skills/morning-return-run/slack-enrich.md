# Slack, enrichment pass

Answers in Slack what the other sources' base passes asked: who mentioned
my PRs, what's been said about today's outside meetings, which teammates the
names belong to, and their profiles. It owns no brief field: everything it
finds is a hand-off the merge and meeting prep use.

Use the window's start date for `after:` filters. Skip any message whose
permalink is in `slack.json`'s `seen`: the base pass has it already.

- **PRs** (`pr_mentions`): for each entry in `github.json`'s `pr_keys`, at
  most 12, one `slack_search_public_and_private` for its URL or
  `<repo name>#<number>`. Each message that turned up is an Item (the
  brief format's, with my words for the title) plus `pr: {repo, number}`,
  `from_email`, `to_me` (it's a DM to me or mentions me) and `line`, one
  short sentence saying who mentioned it where.
- **Meetings** (`meeting_threads`): for each meeting in `calendar.json`'s
  `meeting_keys` with `external_domains`, and each invite in `gmail.json`,
  at most 5, one search over the last 30 days for the organisation's name or
  domain, an outside attendee's name, or the title. Under the meeting's key,
  each relevant thread as `{url, when, who, summary}`: one sentence, in my
  words, on what was said.
- **Names** (`names`): each name in `calendar.json`'s `ooo_names` and
  `linear.json`'s `linear_names`, and each commit author name in
  `github.json`'s `commit_identities` that has no Taxwire email, at most 10:
  one `slack_search_users` each. A Slack user with a Taxwire email gives
  `{name: email}`; no match gives `{name: null}`.
- **Profiles** (`people_profiles`): for each teammate email the base parts
  name or you just matched, except those listed in
  `<scratch>/people-fresh.txt`, `slack_search_users` (detailed) gives
  `{email: {name, photo_url}}`, `photo_url` being their largest profile image.

## Output

Write `slack-enrich.json`. Reads `github.json`, `calendar.json`,
`gmail.json` and `linear.json`, and `<scratch>/people-fresh.txt`. At most 12
PR searches, 5 meeting searches and 10 name searches.
