# Gmail, base pass (`sources.gmail`)

Fills `mail_asks`, and hands invites to today's events to meeting prep.

**Asks:** `search_threads` with `in:inbox newer_than:2d -from:me
-category:promotions -category:social -category:updates
-from:notifications@github.com`, then `get_thread` (`PLAIN_TEXT`) on each.
Keep a thread when its newest message isn't from me, I'm in its `to` (not
reached through a mailing list), and it asks me something or asks me to do
something. At most 8 → `mail_asks`, each an Item with the thread's `viewUrl`
as `url`, my words for the title, teammates in `people`, anyone else in
`who`, `tag` `null`, and `action` when there is one specific thing to do
(`by` `null`: the merge sets it when the sender is in a meeting today). The
sender's email goes in `senders` under the Item's `url`.

**Invites:** `search_threads` with `subject:Invitation newer_than:14d` (and
`subject:"Updated invitation"`). Each invite to an event today becomes a
Meeting in `invites`: `on_calendar: false`, its `url` the invite's "view
event" link (`https://calendar.google.com/calendar/event?action=VIEW&eid=…`),
`context` and `action` `null`, `kind` `other`, `org` the organiser's
organisation when the invite names it, otherwise `null`. Whether I've opened
the email doesn't matter. Whether the event is also on my calendar is for
meeting prep and the merge to decide.

## Output

Write `gmail.json`. Reads no other part.
