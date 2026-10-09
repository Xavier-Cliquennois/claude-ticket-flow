# FAQ and troubleshooting

Common questions about ticket-flow, and what to do when something does not
work.

> Up to date as of 2026-10-09 (ticket-flow 0.1.0).

**Do I have to run `setup-project` in every project?**
Once per project, and again when its way of working changes. Without it the
skills still work on defaults (GitHub issues, 3 agents, standard template) but
guess more and ask more.

**Can I keep my own ticket template or labels?**
Yes. If `CLAUDE.md` describes a template, `write-ticket` uses it; the size gate
and model labels still apply. Existing label taxonomies are kept.

**Why can't a subagent compact itself at 35 %?**
Claude Code does not expose that: a subagent cannot run `/compact`, and a mod
can only compact the main conversation. Automatic compaction does run inside
subagents at the engine's own threshold. ticket-flow keeps tickets small
instead, which keeps context low by construction.

**run-epic says it found no epic.**
Name one: `#N`, a Linear id, a Linear project, or a list of tickets. In Linear
an epic is a parent issue or a project; the `epic` label is optional.

**Agents report "browser test NOT DONE".**
Chrome was not reachable and Playwright was not available either. Open Chrome
with the Claude in Chrome extension (`/chrome`), or enable the `playwright`
plugin, then ask the orchestrator to re-run the check.

**`gh project` commands fail.**
The `gh` token lacks the `project` scope: `gh auth refresh -s project`.

**The machine is slow or tests fail randomly during an epic.**
Lower the max parallel agents in `CLAUDE.md`, name heavy commands as exclusive
resources, and limit test workers in the verify commands.

**The security review blocks the same ticket twice.**
`run-epic` parks it and tells you. Read the findings in the ticket comment;
either fix the design or split the ticket.

**I see skills twice, e.g. `/write-ticket` and `/ticket-flow:write-ticket`.**
You also have copies in `~/.claude/skills/`. Remove those copies to keep one
source.

**The doc reminder fires on every commit.**
It is a reminder, it never blocks. If no doc is concerned, Claude says so and
commits.

**The `orchestra` pane does not appear.**
Check the plugin is installed (`/plugin`), then run `/orchestra`. A failing
mod is named in the transcript once per load; `claude --debug` gives details.
