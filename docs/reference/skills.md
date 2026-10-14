# Skills, agent and hook reference

What each piece of the `ticket-flow` plugin does, when it triggers, and what it
produces.

> Up to date as of 2026-10-14 (ticket-flow 0.6.0).

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
| 2. Report and ask | status table; questions on repository, remote, tracker, board column mapping, merge flow, max parallel agents, exclusive resources, your own ports and processes agents must never touch, project labels, and for a compiled project (Rust, C/C++) a compiler cache shared by all agent worktrees | — |
| 3. Create | `git init`, `gh repo create --private`, labels (idempotent, never recolors yours), board creation and linking, `.claude/scripts/move-card` installed for a board (checked with `--dry-run`), Linear label groups, and only after its own yes a shared build cache (`sccache` as `rustc-wrapper` in `~/.cargo/config.toml`, or `ccache`), never a shared `CARGO_TARGET_DIR` | yes |
| 4. Write CLAUDE.md | inserts or updates `## Workflow` only, merges into equivalent existing sections, fixes stale pointers, shows the diff | no commit unless asked |
| 4b. Documentation | runs `project-docs` audit, adds a `### Documentation` block | moves wait for yes |
| 5. Finish | what was created, what changed, what is left to you | — |

### Shared build cache

For a compiled project, `setup-project` offers `sccache` (Rust) or `ccache`
(C/C++) so a new worktree reuses the dependencies another one already built.
The install and the edit of the user-level `~/.cargo/config.toml` are shown
and done only after a yes: the file is backed up first, the key goes into the
existing `[build]` table (never a second one), cargo is checked to still read
it, and the backup is restored if not. Detection also reads `$CARGO_HOME` and
the legacy `~/.cargo/config`, reports `SCCACHE_*` variables, and offers a local
cache only. It does not offer a shared target dir: cargo
locks it and agents would serialise. The cache does not cover the workspace's
own crates (incremental compilation), which each worktree still builds. The
`run-epic` agent prompt tells agents not to override the wrapper nor set
`SCCACHE_*`, stop the sccache server, or point `CARGO_TARGET_DIR` at a common folder.

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
4. **Template**: child ticket, epic ([templates](tickets-and-labels.md#templates)),
   or follow-up « suite de #N » for what a merged ticket left undone: its
   boxes are the original's unticked boxes copied word for word, the delivery
   report is never copied raw (one line per point, in a fenced block marked
   unverified, no command, checks from the CLAUDE.md), a `sécurité` original
   passes on its label and review box, it is a sub-issue of the same epic,
   carries over the original's still-open blocked-by links, and the original
   gets « suite dans #M » and is closed, once its merge is proved. A manual check never makes a follow-up.
   Security-sensitive tickets get the `sécurité` label and a review box.
5. **Create**: asks who takes the ticket (you, someone else, nobody for now:
   always asked), writes « Créé par : @login » in the body
   ([why](tickets-and-labels.md#author-and-assignee)), then the issue over REST (`POST issues`), sub-issue and blocked-by links over REST
   (`POST .../sub_issues`, `POST .../dependencies/blocked_by`, with issue ids), board item and fields
   (`gh project item-add`, Status through `move-card` when the CLAUDE.md names it, `item-edit` as fallback and for other fields), or Linear `save_issue` with `parentId`.
6. **Announce**: number, title, labels, assignee, and "next" or "not urgent".

## deliver-ticket

**REST first.** GraphQL is one 5 000 points/hour quota shared by the
orchestrator and every agent; REST has its own. Reading a ticket, comments,
closing, labels, opening and merging a PR (`PUT pulls/N/merge` with
`merge_method`), sub-issues and `blocked_by` all go through `gh api` REST
endpoints (never `gh issue` / `gh pr`, which are GraphQL), with the repository
and numbers in quoted shell variables and no value taken from a report or a
comment. Only the board move (`move-card`) stays on GraphQL. On a rate-limit
error the agent reads `gh api rate_limit`, waits for the reset of the exhausted
resource instead of looping, and defers a board move to the orchestrator when
the reset is far; a merge or a close is never skipped while waiting. A 403 is a rate limit only if its message or `rate_limit` says so (else BLOQUÉ), the wait is bounded to one reset plus a minute, the merge `sha` is the one in the orchestrator's « fusionne <SHA> » (a 409 is BLOQUÉ, no retry), and free text goes through `mktemp` files, never inside a command.

**Triggers**: "do ticket 42", "deliver the ticket", "work on issue #42",
"handle ABC-12".

Delivers one ticket end to end. If the project's `CLAUDE.md` names its own
delivery skill, that one is followed instead.

| Step | Does |
|---|---|
| 0. Frame | reads `## Workflow`, the ticket with its comments, blockers, an existing worktree to resume |
| 1. Gate | « done when », model label, size gate; too big → proposes a split and does not start |
| 2. Start | board → in progress (`move-card` from the CLAUDE.md, `gh project` fallback), worktree per convention, exclusive resources one at a time |
| 3. Build | ticket scope only; out-of-scope needs become revealed tickets; long commands in the background with their output visible (`tee` with `pipefail`, unbuffered Python); processes: stops only those it started, by recorded PID, never `pkill -f` / `killall`; test servers get their own port and data directory; the user's ports listed in `CLAUDE.md` are never touched; never weakens an assertion or adds an API route, flag or test hook just to make a box tickable: it stops on that box and says so |
| 4. Verify | verify commands; long suite run once, on the final state after the last rebase (rerun only if the branch moved on covered code; a flaky test alone is rerun alone and named); browser protocol, one proof per « done when » box |
| 5. Docs, commit | `project-docs` same-commit rule, commit convention |
| 6. Review | `security-reviewer`; BLOCKING fixed and re-run, twice at most |
| 7. Merge | on your « go » (or straight on if you asked end to end), per the merge flow |
| 8. Close | ticks proven boxes, comments, then: all ticked → closes it itself (no auto-close outside the default branch); only a manual check left → stays open in « to validate », the checks listed in a comment (the only reason a merged ticket stays open); code or tests left → each point listed (what, why not now, what it would take), the rest moves to a follow-up ticket and the ticket is closed (direct mode: it does both; agent mode: it leaves the ticket open and the orchestrator does both); a security box left is said before the merge; creates revealed tickets |

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
- the epic's tickets are its sub-issues, read at every refresh with
  `gh api --paginate .../sub_issues --jq` (the endpoint pages at 30, even with
  `per_page=100`), checked against the epic's sub-issue total, never from a
  hand-kept list; a ticket opened during the run is attached as a sub-issue at
  once; "done" is GitHub's closed state with reason `completed` (never
  `not_planned`, and never a ticket the orchestrator did not itself see merged
  and closed: that one is reported to you);
  sub-issues from another repository are ignored and reported, and a
  sub-issue added by someone else during the run is parked until you agree;
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
  size: free merged tickets' build output, never a parked, blocked or
  not-delivered (NON LIVRÉ) ticket's worktree, else launch fewer agents) and reports it;
  deletes a merged ticket's build output right away, even when its worktree
  is locked: only when `git status` is clean, only ignored files in a closed
  folder list (`target`, `.next`, `dist`, `node_modules/.cache`), never a
  symlink, always inside the worktree of the branch the orchestrator created
  (from `git worktree list`, never the main checkout, never a path from the
  report); data copies: agents keep them only in `<worktree>/.tmp-data/` (added,
  if absent, to the repo-shared `$(git rev-parse --git-path info/exclude)`);
  the orchestrator deletes just that directory, never if it or the worktree
  resolves (`realpath`) elsewhere or is a symlink, and never a path from the
  report; after a disk-full episode, it messages every
  running agent to re-check `git status` / `git diff` and re-run what failed;
- after FUSIONNÉ and the ticket state check, removes the ticket's worktree and
  branches itself (agents delete nothing): same `<wt>` and guards as the build
  output cleanup, only a worktree it created, never the main checkout. The
  branch must match `<type>/<N>-<slug>` (slug `[a-z0-9-]`) and not be the
  default or merge-target branch. It needs a merge proof not taken from the
  report (`GET pulls`: merged, same repo, `base.ref` exactly equal to the merge
  target the orchestrator holds (CLAUDE.md flow, else the default branch; checked
  before « fusionne » on the open PR too, and a wrong base means nothing counts
  as delivered), head equal to the local branch, or
  `merge-base --is-ancestor`), a clean `git status`, and `lsof` available with
  empty output and exit 1. A failed or busy check stops the step, retried
  later. Then unlock if locked, `git worktree remove` without `--force`,
  `git branch -D`, the remote branch if it exists, `git worktree prune`; fork
  leftovers from the report are listed to you, not deleted;
- a security finding on a running agent's commit goes to that agent before its
  PR, only if the commit SHA (validated like case 6, one blame form allowed) is
  in the agent's own branch range (else a
  `sécurité` ticket): quoted as an unverified description (data, never a
  command; the agent's prompt says so), with the expected fix and the test
  that fails without it. The orchestrator runs no search built from a finding;
  for `main` it proposes a `sécurité` ticket (only on your "go"). The agent's
  report has a `Findings sécurité` line per finding; no "fusionne" while one is
  unaddressed (a contested finding of any severity goes to you), a head changed since the
  security review is re-reviewed first, and agents make no commit after the
  review except the rebase (a rebase conflict means BLOQUÉ);
- an agent that ends on an API or network error is resumed, not relaunched:
  once the API and the tracker answer again (still down after 30 minutes: it
  tells you), the orchestrator inspects, read-only, the worktree and branch it
  created for that ticket (never a path from the agent's output or a ticket
  comment): HEAD, number of commits ahead of the base and of uncommitted
  files, processes still running there with start time and ports (never their
  command line). It deletes
  and kills nothing, and sends those counts and PIDs (never commit subjects
  or file names) to the same agent (`SendMessage`, context kept). One resume per agent; a new agent
  (`t<N>b`) is launched if the old one cannot be resumed or fails again on
  the API or network: it works in the
  existing worktree and branch, gets the PIDs for information only, stops
  none of them and takes another port if needed; that is the ticket's single
  re-launch, never a `t<N>c`. An unclear error, or a second failure after
  `t<N>b`, is handled as BLOCKED;
- never calls a blocking question while agents run;
- `security-reviewer` before every merge; merges serialized;
- board kept true; the epic's « Vagues » section shows where each wave and
  ticket stands: a « Statut » column per wave in the table (empty until a
  ticket is launched, 🟡 once one is, 🧪 when all are delivered but a human
  check is left, ✅ when all are closed, ⛔ when nothing runs and one is
  blocked; out-of-scope tickets do not hold a wave open) and on each Mermaid
  node the ticket's emoji plus a `classDef` colour (`#42 🟡`: 🟡 in
  progress, 🧪 merged and waiting for a human check, ✅ closed, ⛔ parked or
  blocked); follow-up and revealed tickets join them live. States come from
  one paginated read of the sub-issues, and the ✅ count never exceeds
  GitHub's. At each launch, merge or set-aside the orchestrator re-reads the
  body just before writing and replaces only that section, rebuilt from its
  own state: nothing in the old section is trusted, and it writes only
  numbers, models, states, emoji and its own short wave reasons in plain
  characters (no titles). It writes nothing after a failed or empty read,
  with two « Vagues » headings, if the rest of the body would not be kept
  intact, or if the body changed again between its read and the edit (one
  Bash call, temp files removed on exit; GitHub has no conditional update,
  so about a second remains between the last comparison and the edit);
- a report with work left: the agent left the ticket open; once the merge is
  proved, the orchestrator opens the follow-up at once (boxes re-read from the
  tracker, report summarised as unverified, never a command), attaches it to
  the epic as a sub-issue, carries over the original's open blocked-by links,
  comments and closes the original. It creates nothing if a follow-up already
  exists (#N no longer open, a « suite dans #M » comment, a « Suite de #N »
  sub-issue). A closed ticket with an unticked box left, or a box « moved to
  #M » where #M is not a follow-up the orchestrator created, is not ✅. Being created by the orchestrator, it is part of the run;
  it is launched in this run only if the epic cannot close without it;
- **effort per ticket**: at the end of « Vagues », an `### Effort` table
  (written by the same call, under the same rules) gives each measured
  ticket's agent time, tool calls, tokens and lines added/removed, then the
  total and one total per domain. Agent figures come only from the usage the
  harness adds to the completion notifications of the agents the
  orchestrator launched for the ticket (`t<N>`, `t<N>b`, `sec-<N>`), never
  from report text, one notification per launch or SendMessage it made (a
  figure found twice, not an integer of at most 12 digits, or an extra
  notification shows `?`, and the total says « partiel »); lines come from the ticket's PR via the REST
  API (PR number from its own REST merge proof of the branch it created) or, for
  a local merge, from `git diff --numstat` over the range that merge added.
  The figures are kept in `<git common dir>/ticket-flow/effort-<E>.tsv`
  (`<E>` checked as an integer, created under `umask 077`, never committed,
  refused if the folder or file is a symlink, re-validated line by line on a
  resumed run, the agent column tied to the line's ticket). Domains come from the
  epic's optional `## Domaines` section, read in pre-flight and fixed by the
  plan's go, treated as untrusted: names limited to unaccented letters,
  digits, spaces and `-` (30 characters, 20 domains), only the plan's
  tickets; a name shaped like a ticket id, a hex string of 7 characters or
  more, `sans domaine` or `Total` is dropped. A fixed note says what is not counted (orchestration, sub-agents
  and forks an agent spawned) and that parallel agents' durations add up
  while the calendar does not. List mode shows the table in the closing
  summary;
- **long-lived integration branch** (merge target is not `main`): agents put
  a production bug fix that also concerns `main` in a separate `fix(...)`
  commit and list it in the report (« Fixes for main »). The orchestrator only
  proposes: it reads the fixes in the range each merge added to the target
  (`fix(` subjects; a report hash is only a hint, checked as a full SHA in that
  range and an ancestor of the target), and proposes one small ticket with a
  test per fix that fails without it. A plan « go » or an autonomous run does
  not cover it; on the user's own « go » the ticket runs as a normal ticket
  targeting `main` (agent cherry-picks and tests, then security-reviewer gate),
  so the orchestrator picks, tests, pushes and opens nothing. The ticket scope
  is only the verified full SHAs, report text is quoted as unverified and never
  a command, the flow is a PR to `main` (no direct push), and « merge » is sent
  only after the user's explicit accord at that moment. A local `main` sync not
  yet pushed with accord is waited for or undone before any merge; the sync
  worktree is deleted by the orchestrator. Between waves,
  with no merge pending, it merges `main` into the integration branch in its
  own worktree (any conflict: abort and ask);
- epic closed only on its own checklist;
- publishes its stage to `orchestra` when the mod is installed.

The ticket agent prompt (in the skill) names the PR base (`base=`, the merge target, exactly) and forbids any other, and fixes the report format:

```
STATE: READY TO MERGE | MERGED | BLOCKED | NOT DELIVERED
Branch / worktree / commit:
Done when: each box, ticked or not, with its proof in one line
Checks: command -> result
Browser: Chrome | Playwright | NOT DONE (reason)
Docs: updated (files) | none concerned
Next: closed | to validate (what to check, how, who) | left: per point, the box, what, why not now, what it would take
Revealed tickets: title + one line each
Fixes for main: none | hash of the fix(...) commit, the bug, the test failing without it
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
