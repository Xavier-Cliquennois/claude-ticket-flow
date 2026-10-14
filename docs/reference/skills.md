# Skills, agent and hook reference

What each piece of the `ticket-flow` plugin does, when it triggers, and what it
produces.

> Up to date as of 2026-10-13 (ticket-flow 0.5.1).

Skills trigger two ways: by their slash command (`/ticket-flow:<name>`) or when
Claude recognises the request from the skill's description (the trigger
phrases below). Skills read the project's `## Workflow` section of `CLAUDE.md`
([reference](workflow-section.md)) and fall back to defaults without it.

## setup-project

**Triggers**: `/ticket-flow:setup-project`, "set up this project", "upgrade the
CLAUDE.md", a repository with no `CLAUDE.md`.

| Step | Does | Asks first? |
|---|---|---|
| 1. Inspect | git status and history, remote, `gh repo view`, labels, recent issues, GitHub Projects (`gh project list`, `field-list`), Linear MCP, `CLAUDE.md` / `AGENTS.md` / copilot instructions, `.claude/` hooks and skills, CI workflows, stack and verify commands, project memory notes | no (read-only) |
| 2. Report and ask | status table; questions on repository, remote, tracker, board column mapping, merge flow, max parallel agents, exclusive resources, your own ports and processes agents must never touch, project labels | — |
| 3. Create | `git init`, `gh repo create --private`, labels (idempotent, never recolors yours), board creation and linking, `.claude/scripts/move-card` installed for a board (checked with `--dry-run`), Linear label groups | yes |
| 4. Write CLAUDE.md | inserts or updates `## Workflow` only, merges into equivalent existing sections, fixes stale pointers, shows the diff | no commit unless asked |
| 4b. Documentation | runs `project-docs` audit, adds a `### Documentation` block | moves wait for yes |
| 5. Finish | what was created, what changed, what is left to you | — |

### move-card

`plugins/ticket-flow/scripts/move-card`, copied by `setup-project` into a
project with a GitHub Project board as `.claude/scripts/move-card`. It moves
one issue's card without listing the board: it reads the card from the issue
(`issue { projectItems }`, about 1 GraphQL point), then sets the field with
`updateProjectV2ItemFieldValue`, so a move costs about 2 points whatever the
board size (`gh project item-list` costs hundreds on a large board and misses
cards past `--limit`).

```
move-card [--dry-run] [--repo OWNER/REPO] [--project N] [--field NAME] ISSUE STATUS
```

`STATUS` is the exact option name; `--project` is needed only when the issue
sits on several boards; `--field` defaults to `Status`; `--dry-run` does the
lookup and changes nothing. Arguments are validated and reach GitHub only as
GraphQL variables. Exit codes: 0 done, 1 bad usage, 2 card, field or option
not found (the message lists the options), 3 GitHub API failure.

## write-ticket

**Triggers**: "create a ticket", "open an issue", "make an epic", "split
this", tickets revealed during a delivery.

1. **Understand**: reads the code involved, searches existing tickets (no
   duplicates), names the files likely touched. If it cannot name them, the
   ticket becomes a short investigation ticket.
2. **Size gate**: scores the ticket and splits it if too big
   ([details](tickets-and-labels.md#the-size-gate)).
3. **Model label**: `model:opus` if the agent must choose between options the
   ticket does not settle, else `model:sonnet`.
4. **Template**: child ticket or epic ([templates](tickets-and-labels.md#templates)).
   Security-sensitive tickets get the `sécurité` label and a review box.
5. **Create**: asks who takes the ticket (you, someone else, nobody for now:
   always asked), writes « Créé par : @login » in the body
   ([why](tickets-and-labels.md#author-and-assignee)), then `gh issue create`, sub-issue and blocked-by links through GraphQL
   (`addSubIssue`, `addBlockedBy`), board item and fields
   (`gh project item-add`, Status through `move-card` when the CLAUDE.md names it, `item-edit` as fallback and for other fields), or Linear `save_issue` with `parentId`.
6. **Announce**: number, title, labels, assignee, and "next" or "not urgent".

## deliver-ticket

**Triggers**: "do ticket 42", "deliver the ticket", "work on issue #42",
"handle ABC-12".

Delivers one ticket end to end. If the project's `CLAUDE.md` names its own
delivery skill, that one is followed instead.

| Step | Does |
|---|---|
| 0. Frame | reads `## Workflow`, the ticket with its comments, blockers, an existing worktree to resume |
| 1. Gate | « done when », model label, size gate; too big → proposes a split and does not start |
| 2. Start | board → in progress (`move-card` from the CLAUDE.md, `gh project` fallback), worktree per convention, exclusive resources one at a time |
| 3. Build | ticket scope only; out-of-scope needs become revealed tickets; long commands in the background with their output visible (`tee` with `pipefail`, unbuffered Python); processes: stops only those it started, by recorded PID, never `pkill -f` / `killall`; test servers get their own port and data directory; the user's ports listed in `CLAUDE.md` are never touched |
| 4. Verify | verify commands; long suite run once, on the final state after the last rebase (rerun only if the branch moved on covered code; a flaky test alone is rerun alone and named); browser protocol, one proof per « done when » box |
| 5. Docs, commit | `project-docs` same-commit rule, commit convention |
| 6. Review | `security-reviewer`; BLOCKING fixed and re-run, twice at most |
| 7. Merge | on your « go » (or straight on if you asked end to end), per the merge flow |
| 8. Close | ticks proven boxes, comments, then: all ticked → closes it itself (no auto-close outside the default branch); human check left → « to validate »; code left → follow-up ticket; creates revealed tickets |

Two modes: **direct** (in your session, all steps) and **agent** (a `run-epic`
ticket agent: it stops at step 6 with READY TO MERGE, the orchestrator runs the
review and says « merge »). The report format is the one below.

## run-epic

**Triggers**: "run epic #N", "launch the epic", "run the wave", "autonomous
night on the epic", "run tickets 12, 14 and 17", "run ticket 42 in the
background".

See [Running an epic](../guides/running-an-epic.md) for the full walkthrough.
Key behaviours:

- names the epic or asks; never picks one;
- **list mode**: a plain list of tickets (one or more) runs the same way,
  without the epic steps (epic line, card, closing comment);
- ticket agents follow `deliver-ticket` in agent mode (or the project's own
  delivery skill);
- pre-flight: size gate, model labels, waves from blockers and file overlap,
  human-only tickets parked;
- at most N background agents (`CLAUDE.md`, default 3), refilled at once;
- one agent at a time on each exclusive resource;
- ticket agents stop only the processes they started, by PID (no kill by pattern or port), so parallel test servers never kill each other;
- ticket agents never launch sub-agents or forks; if one did, its report
  lists their worktrees and branches for cleanup. Load, not only agent
  count, is the limit: flaky timing tests under load mean lowering N;
- checks free disk before each wave (below 20 GB or N x one agent's build
  size: clean finished worktrees, else launch fewer agents) and reports it;
  deletes a merged ticket's build output (`target/`, caches, data copies) right
  away, even when its worktree is locked; after a disk-full episode, running
  agents re-check `git status` / `git diff` and re-run what failed;
- never calls a blocking question while agents run;
- `security-reviewer` before every merge; merges serialized;
- board kept true; the epic's wave table and Mermaid graph show each
  ticket's status (🟡 in progress, 🧪 merged and waiting for a human check,
  ✅ closed, ⛔ parked or blocked); follow-up and revealed tickets join them
  live;
- epic closed only on its own checklist;
- publishes its stage to `orchestra` when the mod is installed.

The ticket agent prompt (in the skill) fixes the report format:

```
STATE: READY TO MERGE | MERGED | BLOCKED | NOT DELIVERED
Branch / worktree / commit:
Done when: each box, ticked or not, with its proof in one line
Checks: command -> result
Browser: Chrome | Playwright | NOT DONE (reason)
Docs: updated (files) | none concerned
Revealed tickets: title + one line each
Risks / what I could not verify:
```

(The prompt itself is in French; the agent answers in the user's language.)

## project-docs

**Triggers**: writing or updating a doc, adding a diagram, "clean docs",
"audit the docs", a ticket closing with docs affected.

- **Layout**: `README.md`, `CLAUDE.md`, optional `CHANGELOG.md` at the root;
  `docs/README.md` index, `architecture/`, `guides/`, `reference/`,
  `decisions/` (ADRs), `brainstorms/`, `assets/`, `archive/`. A project with a
  strong existing layout keeps it.
- **Not docs**: plans and TODOs (tickets), prompts, one-off audits, backups.
- **Every doc**: kebab-case name; H1, one sentence on the question it answers,
  `> Up to date as of <date> (<commit>)`; describes what is; one subject; paths
  in backticks must exist; updated in the same commit as the code; no secrets.
- **Diagrams**: Mermaid `flowchart`, `sequenceDiagram`, `erDiagram`,
  `stateDiagram-v2`, `gantt` for flows (max ~15 nodes, validated with
  `@mermaid-js/mermaid-cli`); hand-written SVG in `docs/assets/` for space,
  geometry and UI sketches (`viewBox`, own background or dark-mode style,
  system font, `<title>`, checked visually).
- **Audit mode**: inventory, broken references, stale, orphan, misplaced,
  duplicates; a table of proposed actions; `git mv` and link fixes only after
  your yes.

## brainstorm

**Triggers**: "brainstorm", "what should we do next", "ideas for the project".

| Phase | What happens |
|---|---|
| 1. Ground | reads `CLAUDE.md`, README, docs index, open and recent tickets, git history (where effort went, hotspots, TODOs), past sessions; shows a 10-line brief; asks subject, format (express ~30 ideas / deep 60-100) and constraints |
| 2. Diverge | 2-4 techniques among: real frictions, user journey, jobs to be done, what if ×10 / ÷10, inversion, pre-mortem, SCAMPER, first principles, analogies, six hats, competitors, delete; quantity before judgment; domain change every ~10 ideas; each idea tied to a file, ticket or user moment |
| 3. Converge | themes, impact / effort / confidence scores (1-3), quick wins, bets, to explore, dropped; you pick 3-5 |
| 4. Capture | writes `docs/brainstorms/YYYY-MM-DD-<topic>.md`; offers tickets through `write-ticket` |

Inspired by the BMAD method's brainstorming workflow, shorter and grounded in
the repository.

## security-reviewer (agent)

Read-only (`Read`, `Grep`, `Glob`, `Bash`), runs on Opus. Given a branch, a
worktree or a PR (default: the working tree's diff), it reviews the changed
code and the code needed to judge it, against the project's `CLAUDE.md` rules
and a ten-point checklist: authentication, authorization/ownership, input
validation, injection (SQL, shell, eval, deserialization, path traversal,
SSRF), output encoding and error leaks, secrets, crypto and tokens, personal
data, dependencies and config (including known framework CVEs), abuse and rate
limits.

Each candidate finding is challenged before it is reported and marked
CONFIRMED or PLAUSIBLE. Severity: HIGH (exploitable by an ordinary user),
MEDIUM (conditional, or a mandatory project rule broken on a sensitive path),
LOW (hardening). Verdict: BLOCKING (HIGH or MEDIUM in scope), OK WITH
RESERVATIONS, OK. Out-of-scope findings become tickets.

## Update band

A hooks module (`plugins/ticket-flow/hooks/update-band.tsx`) that draws a row above the prompt, in the terminal
and in the desktop app:

- **New version**: at session start, then every 6 hours, it reads the
  published `plugin.json` on `main` (raw GitHub, or `gh api` for a private
  repository). When it is newer than the installed one: « ⬆ ticket-flow X
  disponible [ Mettre à jour ] ». The button runs `claude plugin marketplace
  update`, `claude plugin update`, then `/reload-plugins` in the open session;
  a toast confirms the new version. On failure the row shows the error and
  the commands to type by hand. Offline: nothing is shown.
- **Old Workflow section**: when the project's `CLAUDE.md` has a `## Workflow`
  section without `<!-- ticket-flow workflow: N -->` at the current number, a
  second row offers [ Remettre à niveau ], which runs `setup-project`. It is
  re-read after each turn, so it goes away once the section is upgraded.
- **Surfaces without the band** (VS Code, mobile): Claude is told once per
  session, in context, to give the update commands.

Tests: `plugins/ticket-flow/tests/update-band.test.tsx` (terminal and desktop).

## Doc reminder hook

A `PreToolUse` hook on `Bash`: when the command contains `git commit`, it adds
a note to Claude's context asking it to check that `README.md`, `docs/`,
`CLAUDE.md` and project memory still describe the code being committed, and
to fix them in the same commit. It never blocks the commit. Source:
`plugins/ticket-flow/hooks/doc-reminder-on-commit.sh`.
