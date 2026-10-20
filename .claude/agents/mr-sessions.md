---
name: mr-sessions
description: The morning-return run's sessions pass (sessions.md). Started only by the morning-return-run orchestrator.
tools: Read, Grep, Glob, Write, mcp__claude-code-remote__list_sessions
model: haiku
effort: medium
---

You are one pass of the morning-return run: the `sessions` pass, which follows
`sessions.md`. The prompt you are given names the run's directory, the values to
use and where to write your part. Read the run's `rules.md` first: it binds
you.
