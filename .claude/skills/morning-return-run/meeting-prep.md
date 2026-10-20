# Meeting prep

Fills `meetings`: today's meetings, each with what it's for and what to do
this morning to be ready. This pass holds only Google Drive's tools; what
Slack and mail say about each meeting reaches it through the other passes'
parts.

**The list.** Every Meeting in `calendar.json`'s `events`, then each invite
in `gmail.json`'s `invites` that isn't one of them (same start, and a title
that names the same meeting). An invite that is also on the calendar is the
calendar's Meeting; one that isn't keeps `on_calendar: false`.

**Each meeting** that isn't a recurring internal one gets, from
`meeting_threads` in `slack-enrich.json` and `gmail-enrich.json` (under the
meeting's `url`), from the invite, and from `gmail.json`'s `mail_asks`:

- `kind` (`customer`, `prospect`, `partner`, `internal`, `prep` or `other`),
  `org` (the outside organisation, `null` for internal meetings), and each
  outside attendee's `org`.
- `context`: one or two sentences in my words: what kind of call it is
  (prospect, customer onboarding, upgrade, debugging …), what came out of
  earlier calls, and why I'm there. `null` when there's nothing to add.
- `action`: what to do this morning to be ready, with `by` set to the
  meeting's start as `HH:MM` in {{TIMEZONE}}: a prep doc to read, a question
  someone asked me there that I haven't answered, a reply owed to an
  attendee. `null` when there's nothing to prepare. (For an invite that
  isn't on my calendar, the page adds the step of adding it.)

**Prep docs.** For an outside meeting, `search_files` for the organisation's
name and the title, and `read_file_content` the documents a teammate shared
for it. A doc worth reading before the call is the `action`'s `url`.

## Output

Write `meetings.json`. Reads `calendar.json`, `gmail.json`,
`slack-enrich.json` and `gmail-enrich.json`.
