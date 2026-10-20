# Calendars (`sources.calendar`)

Fills `meetings` (meeting-prep.md adds their context), `day_blocks`, `out_of_office` and holiday notes.

`list_calendars`, then `list_events` with `timeZone: "{{TIMEZONE}}"` on each
of these:

- **My calendar** (the one whose id is my email), today 00:00 to tomorrow
  00:00. Every event but declined ones, all-day working-location entries and
  focus or out-of-office blocks is a Meeting. Leave me out of `attendees`.
  `title` is the calendar's, unless it says nothing about the meeting (a
  booking page's "Marissa (Taxwire) - 30 minutes meeting"): then a short
  title naming the organisation and purpose ("PowerPusher check-in").
- **My availability calendar** (its name contains "Availability"), today
  only → `day_blocks`: `focus` for focus time, `lunch` for lunch, `unavailable`
  for anything else. It mirrors my work and personal calendars, so an
  unavailable block is usually a meeting already listed; it only draws the day.
- **Taxwire OOO**, today to 7 days ahead → `out_of_office`. Events are named
  after the person ("Lucas - OOO", "Steffani OOO"); match the name to a
  teammate (people.md) for the email, and skip anyone you can't match.
- **Holidays**, today to 7 days ahead: a public holiday, or a clock change
  (which moves every meeting with the US by an hour for a week), is a note.
