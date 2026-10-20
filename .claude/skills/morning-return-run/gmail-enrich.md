# Gmail, enrichment pass

Finds what mail says about today's meetings with people outside Taxwire.
It owns no brief field: meeting prep reads what it finds.

For each meeting in `calendar.json`'s `meeting_keys` with
`external_domains`, and each invite in `gmail.json`, at most 5: one
`search_threads` with `newer_than:30d` for the organisation's domain, an
outside attendee's email, or the title, then `get_thread` (`PLAIN_TEXT`) on
the threads that are about the meeting. Under the meeting's key in
`meeting_threads`, each such thread as `{url, when, who, summary}`: its
`viewUrl`, its newest message's time, who wrote, and one sentence in my
words on what came out of it or what's still open.

## Output

Write `gmail-enrich.json`. Reads `calendar.json` and `gmail.json`. At most 5
searches.
