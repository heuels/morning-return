# Linear (`sources.linear`)

Fills `linear`, `linear_asks` and `linear_issues`.

`get_user` with `"me"`. Then:

- **Notifications:** `get_notifications` with `unreadOnly: true`, all pages
  back to 30 days ago. Read only; never mark them.
- `assigned`: `issueAssignedToYou` notifications created after `since` (on the
  first run, all unread ones) whose issue isn't started yet, each with
  `get_issue` for status, priority and project.
- `linear_asks`: `issueNewComment`, `issueCommentMention` and
  `issueMention` notifications whose comment asks me something. Check the
  issue's comments (`list_comments`): when my newest comment is after it,
  it's answered. Each becomes an Item, with the issue identifier as `tag`.
- `project_updates`: `projectUpdatePrompt` notifications ("Project update is
  overdue"), one per project.
- `stale`: `list_issues` with `assignee: "me"`, `state: "started"`; keep
  those not updated in 14 days with no open PR among their attachments.
- `linear_issues`: for each distinct `linear_id` on a PR in the brief,
  `get_issue` with its attachments. Each GitHub pull request attachment is a
  PR of the issue; its `state` is `open` when it's in the brief, otherwise
  from `pull_request_read` `get` (`merged: true` → `merged`, else `closed`).
