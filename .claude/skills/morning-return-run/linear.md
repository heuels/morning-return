# Linear, base pass (`sources.linear`)

Fills `linear` and `linear_asks`.

`get_user` with `"me"`. Then:

- **Notifications:** `get_notifications` with `unreadOnly: true`, all pages
  back to 30 days ago. Read only; never mark them.
- `assigned`: `issueAssignedToYou` notifications created after the window's
  start (on the first run, all unread ones) whose issue isn't started yet,
  each with `get_issue` for status, priority and project. `by` is the
  assigner's email.
- `linear_asks`: `issueNewComment`, `issueCommentMention` and
  `issueMention` notifications whose comment asks me something. Check the
  issue's comments (`list_comments`): when my newest comment is after it,
  it's answered. Each becomes an Item, with the issue identifier as `tag`
  and the commenter's email in `people` when they are a teammate.
- `project_updates`: `projectUpdatePrompt` notifications ("Project update is
  overdue"), the newest one per project. Such a notification stays unread
  after the project is finished or its update is posted, so check each with
  `get_project` (the slug at the end of its `url`): keep it only when the
  project's `status.type` is `started` and its `lead` is me, and
  `get_status_updates` (`type: "project"`, the project's `id`, `createdAt`
  the notification's) finds no update posted since. `due` is the
  notification's date.
- `stale`: `list_issues` with `assignee: "me"`, `state: "started"`; keep
  those not updated in 14 days with no open PR among their attachments.

A person Linear names without an email goes in `linear_names`.

## Output

Write `linear.json`. Reads no other part.
