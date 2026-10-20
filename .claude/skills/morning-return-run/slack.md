# Slack, base pass (`sources.slack`)

Fills `slack_asks` and `slack_discussions`. Anything about my PRs or today's
meetings that needs another source is the Slack enrichment's (slack-enrich.md).

My Slack user id is the one the Slack search tool's description names, or
`slack_read_user_profile` with no `user_id`. Use the window's start date for
`after:` filters and drop anything older than the window.

**Asks** (`slack_asks`):

- Mentions: `slack_search_public_and_private` with `keywords: ["<@MY_ID>"]`,
  `filters: "after:<date>"`, `sort: "timestamp"`. Group mentions (`@here`,
  `@channel`, user groups) don't count.
- DMs: the same tool with `filters: "is:dm after:<date>"` and `sort:
  "timestamp"`. Then read each DM or group DM that turned up with
  `slack_read_channel` (`oldest` = the window's start).

A candidate is an ask when its newest message asks me something or asks me to
do something. Open its thread once with `slack_read_thread`: if I replied
after the ask, or reacted to it with any emoji (`slack_get_reactions`), it is
not an ask. At most 10 asks, newest first. Each ask's sender's email goes in
`ask_senders` under the ask's `url`.

**Discussions** (`slack_discussions`): threads I've posted in that got replies
after my last message, skipping anything already in `slack_asks`. At most 8,
the ones I'd be most surprised to miss first.

Every ask and discussion becomes an Item: my words for the title, the
permalink as `url`, teammates (Slack users with a Taxwire email) in `people`
and anyone else in `who`. `action` names the one thing to do when it's
specific; `tag` is `null` (the merge ties items to meetings and PRs).

**Hand-offs.** Every message you read goes in `seen` by permalink. Every
GitHub pull request link in those messages goes in `pr_links`: the message's
permalink as `url`, the PR as `pr: {repo, number}`, the sender's email as
`from_email`, `to_me` true when the message is a DM to me or mentions me, its
time as `when`, and `line`, one short sentence saying who mentioned it where
("Asked you about it in #engineering yesterday").

## Output

Write `slack.json`. Reads no other part.
