# What a Routine session gives the run

Measured on 2026-10-20 with throwaway sessions on the `spike-agents` branch
(`session_016RmK8r6psqKz3PqdUpmRPb`, `session_01QNfZbHn1TToeDwEE62742C`),
started the way a Routine starts one: in the Taxwire environment, from server
configuration, with this repository checked out. Check again when something
here stops matching what a run does.

## Agent definitions

- `.claude/agents/*.md` in this repository load: an agent defined there is
  offered as a `subagent_type`. The run's skill is listed too.
- The Agent tool takes `description`, `prompt`, `subagent_type`, `model`
  (`sonnet`, `opus`, `haiku`, `fable`), `effort` (`low` to `max`),
  `run_in_background` and `isolation`.
- A definition's `model:` is honoured: a probe defined with `haiku` ran on
  `claude-haiku-5-5`.
- `tools:` is enforced: a tool the definition doesn't list is refused ("No
  such tool available"). A name that doesn't exist in the session is dropped
  without an error, and `ToolSearch` isn't granted even when listed, so a
  defined agent can only use tools named exactly.
- A tool-limited agent starts small: about 5K tokens of context, against
  about 74K for `general-purpose`, which carries every tool's definition.
- Three subagents started in one message ran at the same time.

## Tool names

Sessions started from server configuration name connector tools by the
connector's id, not its display name: `mcp__<connector id>__<tool>`. An
interactive session may name the same tools `mcp__Slack__<tool>` and so on.
The ids are the `connector_uuid`s stored on the Morning brief Routine:

| Source | Connector | Tools are named |
|---|---|---|
| slack | Slack | `mcp__8a43f4e5-70cf-4897-b7f9-df683ecf443c__<tool>` |
| gmail | Gmail | `mcp__c7542e7c-885c-48cd-9b74-ecdf4fdf1d26__<tool>` |
| calendar | Google Calendar | `mcp__9a7a8585-9f55-4ba2-9388-b200c6b55844__<tool>` |
| drive | Google Drive | `mcp__379b4aa5-6cf0-49ac-9d45-1f9d61a76a0d__<tool>` |
| linear | Linear | `mcp__0e265249-b98c-497c-b9a3-1c37685deedb__<tool>` |
| github | (the environment's) | `mcp__github__<tool>` |
| sessions | (the environment's) | `mcp__claude-code-remote__<tool>` |

`ArtifactData` keeps its plain name. Reconnecting a connector in claude.ai
may give it a new id; the run's agent definitions then need the new one.

## The Routine itself

- With no model set, the Routine's sessions run on `claude-sonnet-5-5` (its
  last run, `cse_01PeSWfab3vHvnCUzTShmVYM`).
- Its API view (`get_trigger`) doesn't show attached repositories.
