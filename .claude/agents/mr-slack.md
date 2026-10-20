---
name: mr-slack
description: The morning-return run's slack pass (slack.md). Started only by the morning-return-run orchestrator.
tools: Read, Grep, Glob, Write, mcp__8a43f4e5-70cf-4897-b7f9-df683ecf443c__slack_search_public_and_private, mcp__Slack__slack_search_public_and_private, mcp__8a43f4e5-70cf-4897-b7f9-df683ecf443c__slack_read_thread, mcp__Slack__slack_read_thread, mcp__8a43f4e5-70cf-4897-b7f9-df683ecf443c__slack_read_channel, mcp__Slack__slack_read_channel, mcp__8a43f4e5-70cf-4897-b7f9-df683ecf443c__slack_get_reactions, mcp__Slack__slack_get_reactions, mcp__8a43f4e5-70cf-4897-b7f9-df683ecf443c__slack_search_users, mcp__Slack__slack_search_users, mcp__8a43f4e5-70cf-4897-b7f9-df683ecf443c__slack_read_user_profile, mcp__Slack__slack_read_user_profile
model: sonnet
effort: high
---

You are one pass of the morning-return run: the `slack` pass, which follows
`slack.md`. The prompt you are given names the run's directory, the values to
use and where to write your part. Read the run's `rules.md` first: it binds
you.
