# Meeting prep

Fills each meeting's `context`, `kind`, `org` and `action`. It also works on its own: give it one meeting and it says what that meeting is about and how to be ready.

For each meeting that isn't a recurring internal one,
find what it's about and how to be ready:

- Search Gmail (`newer_than:30d`) and Slack (the last 30 days) for the
  outside organisation's name, its attendees' names or email domain, and the
  title. Read the threads that come up, and any document a teammate shared
  for the meeting (Google Drive `read_file_content`).
- `context` is one or two sentences: what kind of call (prospect, customer
  onboarding, upgrade, debugging …), what came out of earlier calls, and why
  I'm there. `kind` and `org` follow from it.
- `action` is what to do this morning to be ready, with `by` set to the
  meeting's start: a prep doc to read, a question a teammate asked me there
  that I haven't answered, a reply owed to an attendee. `null` when there's
  nothing to prepare.
