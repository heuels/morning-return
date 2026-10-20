# Slack and Gmail (`sources.slack`, `sources.gmail`)

Fills `slack_asks`, `slack_discussions`, `mail_asks`, the PRs' `blocking_signal`, and meetings for invites missing from my calendar.

## Slack (`sources.slack`)

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
not an ask. At most 10 asks, newest first.

**Discussions** (`slack_discussions`): messages in the window that mention one
of my open PRs (its URL, or `<repo>#<number>`), and threads I've posted in
that got replies after my last message. Skip anything already in
`slack_asks`. At most 8, the ones I'd be most surprised to miss first.

**Blocking signals:** for each PR in `review_prs`, if its author mentioned it
to me (its URL or number) in Slack in the window, set `blocking_signal` to one
short line, e.g. `Asked you about it in #engineering yesterday`.

Every ask and discussion becomes an Item: my words for the title, the
permalink as `url`, teammates in `people` and anyone else in `who`. `action`
names the one thing to do when it's specific ("Link #4254" when the thread is
about something my PR already fixes); `tag` ties it to a meeting or PR today.

## Gmail (`sources.gmail`)

**Asks:** `search_threads` with `in:inbox newer_than:2d -from:me
-category:promotions -category:social -category:updates
-from:notifications@github.com`, then `get_thread` (`PLAIN_TEXT`) on each.
Keep a thread when its newest message isn't from me, I'm in its `to` (not
reached through a mailing list), and it asks me something or asks me to do
something. At most 8 → `mail_asks`, using the thread's `viewUrl` as `url`.
When the sender is in a meeting today, `tag` names it ("PowerPusher 17:30")
and `action.by` is its start.

**Invites:** `search_threads` with `subject:Invitation newer_than:14d` (and
`subject:"Updated invitation"`). For each invite to an event today, look for
the event on my calendar (calendar.md) by start time and title. One that isn't
there becomes a Meeting with `on_calendar: false`, its `url` the invite's
"view event" link (`https://calendar.google.com/calendar/event?action=VIEW&eid=…`),
and its context from the invite and meeting-prep.md's search. Whether I've opened
the email doesn't matter.
