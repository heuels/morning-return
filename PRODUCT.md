# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: Egor, an engineer at Taxwire. He opens the page at his laptop at the
start of the workday, works through it top to bottom, and clicks out to GitHub,
Slack, Gmail or Calendar to act on each item. He is the only reader.

## Product Purpose

Each weekday morning, one page says what needs him today: pull requests where his
review was asked for by name (with a first-pass review already run), his own pull
requests and the one thing standing between each and a merge, Slack and email
asks he hasn't answered, and today's meetings with enough context to walk in
prepared. Success is working the page top to bottom without hunting through four
tools to find out what he missed.

## Positioning

The gathering and the first-pass reviews happen before he sits down. Pull
requests are ranked by GitHub's own merge state rather than by recency, and the
page only reads: it never posts, replies or merges on his behalf.

## Operating Context

- A claude.ai Routine runs at 07:45 Europe/Lisbon on weekdays, gathers from
  GitHub, Slack, Gmail and Google Calendar, and writes one brief into the page's
  database. The page renders the newest brief.
- The page is a private claude.ai Artifact. It is read on a laptop, in either
  light or dark theme.
- Every item links out to where it is acted on: the PR, the Slack thread, the
  email, the calendar event.
- Reviews come from the `pr-review` plugin's review prompt: a verdict, severity
  counts and a table of findings with file locations.

## Capabilities and Constraints

- The data contract is `skills/morning-routine/brief-format.md`. The page must
  render whatever a brief holds, including empty lists and failed sources.
- A source that couldn't be reached is shown as such, never as an empty section.
- Scheduled runs cannot list Claude Code sessions; that source is a known
  limitation, not an error to show every morning.
- Artifact constraints: plain HTML, CSS and ES modules; fonts only from Google
  Fonts; gathered text is rendered as text; only `https://` links become links.

## Evidence on Hand

Real content comes only from the user's own accounts at run time. Test fixtures in
`tests/fixtures/` are made up and must stay obviously so.

## Product Principles

1. Action items, not prose: each row says what to do next.
2. Rank, don't list: the first thing on the page is the most urgent.
3. Show failures plainly, and nothing else that isn't actionable.
4. Scan in a minute: short text per item, details on demand.
5. Read-only: the page points to where the action happens.

## Accessibility & Inclusion

The user found the previous typeface (Atkinson Hyperlegible) hard to read and the
amount of text per item too high. Body text must favour comfortable reading at
laptop distance, and items must be scannable without reading full sentences.
