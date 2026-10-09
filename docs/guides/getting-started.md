# Getting started

How to install the plugins, set up a project and write a first ticket.

> Up to date as of 2026-10-09 (ticket-flow 0.1.0).

## 1. Prerequisites

| Need | Why | How |
|---|---|---|
| Claude Code | runs everything | <https://docs.claude.com/en/docs/claude-code> |
| `gh`, logged in | GitHub issues, labels, sub-issues | `gh auth login` |
| `project` scope on `gh` | GitHub Projects boards | `gh auth refresh -s project` |
| Linear MCP server | only if the project uses Linear | declare it in the project's `.mcp.json` |
| Claude in Chrome extension | browser checks in your real session | Chrome Web Store, then `/chrome` |
| `playwright` plugin | browser checks when Chrome is closed | `/plugin` → enable `playwright` |

## 2. Install

```
/plugin install ticket-flow --marketplace Xavier-Cliquennois/claude-ticket-flow
/plugin install orchestra --marketplace Xavier-Cliquennois/claude-ticket-flow
```

Skills are namespaced by the plugin: `/ticket-flow:setup-project`,
`/ticket-flow:write-ticket`, `/ticket-flow:run-epic`,
`/ticket-flow:project-docs`, `/ticket-flow:brainstorm`. You can also just ask
in plain words ("write a ticket for…", "run epic #12"): Claude picks the skill
from its description.

## 3. Set up a project

Open Claude Code in the project and run:

```
/ticket-flow:setup-project
```

It works in this order and asks before changing anything:

1. **Inspects** (read-only): git repository, remote, `gh` access, labels,
   existing issues, GitHub Projects boards, Linear MCP, `CLAUDE.md` and other
   instruction files, the stack and its real verify commands, docs.
2. **Reports** what exists, what is missing, what is stale, and asks only what
   it could not infer: create a repository? GitHub issues, a Projects board or
   Linear? how the board's columns map to the five workflow states? merge flow?
   maximum parallel agents?
3. **Creates what you approved**: labels (`model:opus`, `model:sonnet`, `epic`,
   `taille:S`, `taille:M`, `sécurité`; see [labels](../reference/tickets-and-labels.md#labels)), a board, a repository.
4. **Writes the `## Workflow` section** of `CLAUDE.md`, or updates it if it
   exists, without rewriting the rest of the file, and shows you the diff.
5. **Audits the docs** with `project-docs` and proposes a cleanup.

Nothing is committed unless you ask. Run it again whenever the project's way
of working changes (a new board, a move to pull requests, a new test command).

## 4. Write a first ticket

```
/ticket-flow:write-ticket the export button times out on large notebooks
```

The skill reads the code involved, checks for duplicates, names the files
likely touched, scores the ticket against the size gate, picks a model label,
fills the template and creates the issue (and puts it on the board). If the
ticket is too big it proposes an epic with smaller tickets and waves instead.

## 5. Next steps

- [Running an epic](running-an-epic.md)
- [Brainstorm what to do next](../reference/skills.md#brainstorm):
  `/ticket-flow:brainstorm`
- Open the agents pane during a run: `/orchestra`
