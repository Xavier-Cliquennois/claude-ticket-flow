---
name: deliver-ticket
description: Deliver one ticket (GitHub issue or Linear) end to end - read it with its comments, check it passes the size gate, open the worktree, build only its scope, verify, update docs in the same commit, gate the merge on the security-reviewer agent, merge as the project's CLAUDE.md says, tick the "Fini quand" boxes with proof, move the board, open revealed tickets. Runs in the current session, or as the procedure a run-epic ticket agent follows (agent mode, stops before merge). Use when the user says "fais le ticket 42", "livre le ticket", "attaque l'issue #42", "traite ABC-12", "corrige le bug du ticket N", or reports a human check done on a ticket in « à valider » ("j'ai testé #380, c'est bon").
---

# deliver-ticket

One ticket, from reading to closing. Talk to the user in their language.

Two modes:
- **Direct**: the user asked for this ticket in this session. You do every step,
  the security review and the merge included.
- **Agent**: a `run-epic` prompt launched you as `t<N>`. The orchestrator runs
  the security review and says when to merge: stop at step 6 with a « PRÊT À
  FUSIONNER » report, wait for « fusionne », then do steps 7 and 8. The
  orchestrator's prompt wins where it says more (files owned by sibling agents,
  dedicated ports, locks).

To run tickets in the background, several at once, use `run-epic` (an epic or a
plain list of tickets), not this skill.

## 0. Read the frame

- Project `CLAUDE.md`, section `## Workflow`: tracker, board and its status
  mapping, worktree and branch convention, verify commands, browser rule, review
  rule, merge flow, exclusive resources. **If it names a project delivery skill,
  follow that skill instead of this one** and stop reading here.
- Which ticket: the one the user named. None named → list the open tickets
  marked « à traiter à la suite » (or the board's « à faire » column) and ask;
  never pick one.
- The ticket in full: body AND comments, labels, state, blocked-by, parent epic
  (`gh issue view N --json title,body,state,labels,comments` + GraphQL
  `blockedBy`; or the Linear MCP). Comments often change the scope.
- An open blocker → stop and say which; do not start.
- `git worktree list` and branches: a worktree or branch for this ticket is work
  in progress. Read its state (`git log`, `git status`, the last ticket
  comments) and resume it; never recreate it.

## 1. Gate

- The ticket has a « Fini quand » list, a model label and passes the size gate
  of `write-ticket` §2. If it is too big, do not start: propose the split
  (`write-ticket`) and wait. In agent mode, report « NON LIVRÉ » with the
  proposed split.
- Boxes that need a human eye (visual judgment, a product decision, a real
  device) are noted now: you will not tick them yourself.
- Something in the ticket unclear or contradicted by the code: the person in
  « Créé par » is the one to ask (a comment mentioning `@<login>`, after the
  user's yes); never guess the intent. In agent mode, report « BLOQUÉ » with
  the question and who to ask.

## 2. Start

- Board: move the ticket to « en cours » with the CLAUDE.md's `move-card`
  command (« Déplacer une carte »); without it, the `gh project` fallback in
  `write-ticket` §6.
- Worktree per the CLAUDE.md convention (default
  `git worktree add ../<repo>-<N> -b <type>/<N>-<slug>` (slug = title lowercased, every character outside
  `[a-z0-9]` becomes `-`) from the main branch,
  up to date). Work only inside it.
- Exclusive resources the CLAUDE.md names (a benchmark, a shared database, a
  lock): take them only when needed, one at a time, and say so.

## 3. Build

- Scope: this ticket only, the files it names first. A need outside it becomes a
  « ticket révélé » (title + one line), not code.
- Follow the CLAUDE.md's code rules (language, security patterns, style of the
  surrounding code).
- Keep your context light: read excerpts, not whole files; never print long
  outputs (`tail`, `grep`). If the ticket turns out bigger than its size, stop
  cleanly and propose a split rather than pushing through.

### Processes you start

Several agents run side by side on one machine; a pattern kill hits the others.
- A server, watcher or worker you start: record its PID right away (`$!`, or the
  PID it prints) and stop it later with `kill <that PID>` only.
- Never `pkill -f`, `killall` or any kill by name, pattern or port: another
  agent's process, or the user's own, can match.
- A project that runs a local server for tests gives each instance its own port
  and data directory (taken from your ticket number, or a free port) and prints
  the PID. If the project does not, do it in your test setup and report it as a
  « ticket révélé » if the fix is out of scope.
- Never touch the ports or processes the CLAUDE.md lists as the user's own. If
  it lists none, do not stop anything you did not start.

### Long commands

A command that may run more than ~2 minutes (test suite, bench, build, data
run) runs in the background (`run_in_background: true`), and its output goes
to the terminal so the background task records it and the `orchestra` pane
shows it live:
- Never only `cmd > run.log`: the task's output stays empty.
- Want a log file too: `set -o pipefail; cmd 2>&1 | tee run.log`. Without
  `pipefail` the pipe's exit code is `tee`'s, so a failure reads as a success.
- Python writing into a pipe buffers: `PYTHONUNBUFFERED=1` (or `python -u`).
- Wait for the completion notification; do not poll in a loop.

## 4. Verify

- Run the CLAUDE.md verify commands, in order, from the worktree. A red check
  is fixed, not skipped; one you cannot run is reported as not run, with why.
- Long suite (a full run of ~10+ minutes): iterate on the touched tests only.
  Just before the merge (agent mode: before the « PRÊT À FUSIONNER » report),
  `fetch` and rebase once, then run the **full** suite **once** on that final
  state. Never skip it after the last rebase, never rerun it after each rebase.
- The branch moved again before the merge: rebase, and rerun the suite only if
  the new commits touch what it covers. The report says what was rerun and what
  was not. Each merge is backed by one full run on the merged state, stated in
  the report (and the PR, if any).
- A known-flaky test failing alone is rerun alone and named in the report.
- UI change: Chrome first; if Chrome is unreachable or fails 2-3 times,
  Playwright; otherwise write « test navigateur NON FAIT » and why.
- Each « Fini quand » box gets a one-line proof (command and result, file:line,
  screenshot path).

## 5. Docs and commit

- Docs follow `project-docs`: a change that makes a doc wrong updates it in the
  same commit.
- Commit per the CLAUDE.md (message language, Conventional Commits, ticket
  reference such as `#N` / `ABC-N`). Small commits are fine; no unrelated files.

## 6. Security review

- Agent mode: stop here. Send the report (step 9) with ÉTAT « PRÊT À
  FUSIONNER » and wait. On findings, fix them and report again. On
  « fusionne », go to step 7.
- Direct mode: run the `security-reviewer` agent on the branch/worktree.
  - BLOQUANT → fix in scope, re-run. Two BLOQUANT rounds in a row → stop,
    comment the ticket, tell the user.
  - OK / OK AVEC RÉSERVES → out-of-scope findings become `sécurité` tickets
    (`write-ticket`).

## 7. Merge

- Direct mode: show the user a short report (step 9 format) and merge on their
  « go », unless they asked for the ticket end to end without stopping.
- Merge exactly as the CLAUDE.md says (PR to `main`, PR to `dev`, local
  `--no-ff`, after green CI). Never force-push a shared branch.
- Once merged, remove the worktree (`git worktree remove`) unless the CLAUDE.md
  keeps them. In agent mode, leave your worktree and your local and remote
  branches alone: the orchestrator removes them.

## 8. Close

- Tick each « Fini quand » box you proved; leave the others unticked.
- Comment the ticket in a few lines: what changed, merge commit, how each box
  was checked, what is left.
- Then exactly one of three outcomes, from the unticked boxes:
  1. **None left** → close it yourself (`gh issue close N --comment ...`).
     GitHub's `Closes #N` only fires on a merge into the default branch: a
     merge into an integration branch (`dev`, `refacto/x`) closes nothing.
     Check `gh issue view N --json state` after the merge; never assume.
  2. **Only human checks left** (visual judgment, a flash on a board, a
     measurement on a device, a product sign-off; no code to write) → keep it
     open, move it to « à valider » (or the project's equivalent, e.g.
     Testing), and the comment lists what to check, how, and who.
  3. **Code or tests left** (a partial delivery) → never leave it open for
     that: an open ticket with a merged PR must mean « only a check is left ».
     Direct mode: create the follow-up ticket (`write-ticket`, follow-up
     shape), in this ticket replace each moved box by
     `- [x] ~~<case>~~ → déplacée vers #M`, then apply outcome 1 or 2 to what
     remains. Agent mode: leave the ticket open and list the unticked boxes
     under « Reste (code) » in the report; the orchestrator creates the
     follow-up and closes the ticket.
- Later, when someone reports the check done (« j'ai testé #N, c'est bon »):
  tick the box with their words as proof, comment, close, board → « fini »,
  epic node → ✅. A failed check is a bug on the ticket: say what failed in a
  comment, reopen the work (or a follow-up ticket if the code is merged).
- Board to match (`move-card`, as in step 2). Direct mode, ticket in an epic whose body has a « Vagues »
  section: update its node and wave cell as `run-epic` §2 says (agent mode: the
  orchestrator does it).
- Revealed tickets → create them with `write-ticket` (sub-issue of the parent
  epic if they serve its « Fini quand », otherwise standalone, « pas urgent »).
  Agent mode: do not create them, list them in the report; the orchestrator creates them.
- Agent mode: send the report with ÉTAT « FUSIONNÉ ».

## 9. Report

25 lines at most:

```
ÉTAT : PRÊT À FUSIONNER | FUSIONNÉ | BLOQUÉ | NON LIVRÉ
Branche / worktree / commit :
Fini quand : chaque case, cochée ou non, avec la preuve en une ligne
Vérifs : commande → résultat
Navigateur : Chrome | Playwright | NON FAIT (raison)
Doc : mise à jour (fichiers) | aucune concernée
Suite : fermé | à valider (quoi vérifier, qui) | reste (code) : cases non faites
Tickets révélés : titre + une ligne chacun
Risques / ce que je n'ai pas pu vérifier :
```

In direct mode, end with what needs the user (boxes to check by eye,
decisions, revealed tickets to prioritise).
