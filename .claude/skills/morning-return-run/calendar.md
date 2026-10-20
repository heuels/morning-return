# Calendars, base pass (`sources.calendar`)

Fills `day_blocks` and `out_of_office`, and hands today's meetings to the
later passes.

`list_calendars`, then `list_events` with `timeZone: "{{TIMEZONE}}"` on each
of these:

- **My calendar** (the one whose id is my email), today 00:00 to tomorrow
  00:00. Every event but declined ones, all-day working-location entries and
  focus or out-of-office blocks is a Meeting in `events`. Leave me out of
  `attendees`; an attendee's `org` is `"Taxwire"` for a Taxwire email,
  otherwise `null`. `title` is the calendar's, unless it says nothing about
  the meeting (a booking page's "Marissa (Taxwire) - 30 minutes meeting"):
  then a short title naming the organisation and purpose ("PowerPusher
  check-in"). `kind` is `internal` when every attendee is a teammate,
  otherwise `other`; `org`, `context` and `action` are `null` (meeting prep
  fills them). Each also goes in `meeting_keys`: its `url` as `key`, `title`,
  `start`, the attendees' emails, the domains of attendees who aren't
  teammates as `external_domains`, and `recurring`.
- **My availability calendar** (its name contains "Availability"), today
  only → `day_blocks`: `focus` for focus time, `lunch` for lunch, `unavailable`
  for anything else. It mirrors my work and personal calendars, so an
  unavailable block is usually a meeting already listed; it only draws the day.
- **Taxwire OOO**, today to 7 days ahead → `out_of_office`. Events are named
  after the person ("Lucas - OOO", "Steffani OOO"): each becomes
  `{email: null, name, start, end}` with the person's name as the calendar
  gives it, and the name goes in `ooo_names`. The Slack enrichment finds their
  emails; the merge drops anyone it can't match.
- **Holidays**, today to 7 days ahead: a public holiday, or a clock change
  (which moves every meeting with the US by an hour for a week), is a note.

## Output

Write `calendar.json`. Reads no other part.
