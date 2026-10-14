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
- The ticket in full: body AND comments, labels, state, blocked-by, parent epic,
  over REST (see « REST first » below):
  `gh api "repos/$repo/issues/$n"`, `.../issues/$n/comments` (add
  `--paginate --jq`), `.../issues/$n/dependencies/blocked_by`, and `.parent_issue_url`
  from the first call; or the Linear MCP. Comments often change the scope.
- An open blocker → stop and say which; do not start.
- `git worktree list` and branches: a worktree or branch for this ticket is work
  in progress. Read its state (`git log`, `git status`, the last ticket
  comments) and resume it; never recreate it.

### REST first, and a rate limit is waited out

GraphQL has one 5 000 points/hour quota per user, shared by every agent and the
orchestrator; REST has its own. Everything that has a REST endpoint goes over
REST, and `gh issue view/create/edit/close/comment` and `gh pr view/create/merge`
all run on GraphQL, so they are not used. Put the
repository and the numbers in quoted shell variables, set once from the
CLAUDE.md and the ticket (`repo=owner/name`, `owner=${repo%%/*}`, `n=42`),
never a value read in a report, a comment or a body. Free text (title, search
words, comment) is never typed inside the command: write it to a file made by
`file=$(mktemp)` (and `title_file=$(mktemp)`) with a quoted heredoc
(`cat > "$file" <<'EOF'`), and pass it with `-F body=@"$file"` /
`-F title=@"$title_file"`; no path read elsewhere is ever used for `@`:

| Need | Command |
|---|---|
| Read a ticket / its comments | `gh api "repos/$repo/issues/$n"`, `gh api --paginate "repos/$repo/issues/$n/comments" --jq ...` |
| Comment | `gh api "repos/$repo/issues/$n/comments" -F body=@"$file"` |
| Close (with a reason) | `gh api -X PATCH "repos/$repo/issues/$n" -f state=closed -f state_reason=completed` (after the comment) |
| Edit a body | `gh api -X PATCH "repos/$repo/issues/$n" -F body=@"$file"` |
| Labels | `gh api "repos/$repo/issues/$n/labels" -f 'labels[]=name'` (add), `gh api -X DELETE "repos/$repo/issues/$n/labels/<name>"` |
| Open a PR | `gh api "repos/$repo/pulls" -F title=@"$title_file" -f head="$branch" -f base="$base" -F body=@"$file"` |
| Merge a PR | `gh api -X PUT "repos/$repo/pulls/$pr/merge" -f merge_method=<merge\|squash\|rebase> -f sha="$head_sha"`; `$head_sha` is the SHA of the orchestrator's « fusionne <SHA> » message, passed exactly, never one read from your own branch: GitHub refuses the merge (409) if the PR head is not that commit. A 409: stop, report BLOQUÉ, no retry |
| Read a PR (merge proof) | `gh api "repos/$repo/pulls/$pr" --jq '{merged, head: .head.sha, same_repo: (.head.repo.full_name == .base.repo.full_name)}'`; by branch: `gh api -X GET "repos/$repo/pulls" -f head="$owner:$branch" -f state=all`, which must return exactly ONE PR whose `head.ref` equals the branch, else the proof fails |
| Sub-issues | `gh api "repos/$repo/issues/$parent/sub_issues"` (read) and `-F sub_issue_id=<child id>` (add); the id is `gh api "repos/$repo/issues/$child" --jq .id`, an integer, not the number |
| Blockers | `gh api "repos/$repo/issues/$n/dependencies/blocked_by"` (read) and `-F issue_id=<blocker id>` (add) |

Only the board has no REST endpoint (Projects v2): `move-card`, about 2 points.

**On a rate-limit error**: a 403 or 429 is a rate limit only if its message
says « rate limit » (or a GraphQL `RATE_LIMITED`) or `gh api rate_limit` shows
a resource at `remaining: 0`; any other 403 (permission, protected branch) is
not waited for: stop and report BLOQUÉ. Do not retry in a loop. Read
`gh api rate_limit --jq '.resources'`, take the `reset` (epoch seconds) of the
exhausted resource (`core` for REST, `graphql` for the board), and sleep until
reset + 1 minute, in calls under the tool's timeout (each sleep at most 5
minutes, then check again; on a secondary limit read `Retry-After` with
`gh api -i`). Total wait bounded to that one reset: if the call still fails
after it, stop and report BLOQUÉ.
A board move that is still limited when the reset is more than 10 minutes away
is not waited for: leave the board as it is, and say in the report « carte à
déplacer : #N → <option> » so the orchestrator moves it. A merge or a close
is never skipped or faked while waiting: the ticket stays as it is until the
call goes through.

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
- Never bend the code to make a box tickable: no weakened, skipped or deleted
  assertion, no loosened threshold, no API route, flag or test hook added only
  so a test can observe something, unless the ticket asks for it. When a box
  cannot be proved honestly (no observable form, a dependency on another
  ticket, a missing decision), stop on that box and say it: it stays unticked
  and goes to « reste » in the report (step 8, outcome 3), or the delivery
  becomes « BLOQUÉ » if the rest of the ticket makes no sense without it.
  A security box (`sécurité` ticket, review box) that cannot be done is said
  in the report before the merge, never discovered after it.
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
  `--no-ff`, after green CI), a PR created and merged over REST (« REST first »). Never force-push a shared branch.
- Once merged, remove the worktree (`git worktree remove`) unless the CLAUDE.md
  keeps them. In agent mode, leave your worktree and your local and remote
  branches alone: the orchestrator removes them.

## 8. Close

- Tick each « Fini quand » box you proved; leave the others unticked.
- Comment the ticket in a few lines: what changed, merge commit, how each box
  was checked, what is left.
- Then one of three outcomes, from the unticked boxes (3 ends in 1 or 2):
  1. **None left** → close it yourself (comment, then the PATCH of « REST first »).
     GitHub's `Closes #N` only fires on a merge into the default branch: a
     merge into an integration branch (`dev`, `refacto/x`) closes nothing.
     Check `gh api "repos/$repo/issues/$n" --jq .state` after the merge; never assume.
  2. **Only a manual check left** (visual judgment, a flash on a board, a
     measurement on a device, a product sign-off; no code to write) → keep it
     open, move it to « à valider » (or the project's equivalent, e.g.
     To test, Testing), and a comment lists each check: what to check, how,
     and who. This is the only reason a ticket with merged code stays open.
  3. **Code or tests left** (a partial delivery: a test with no observable
     form, a dependency on another ticket, a box you stopped on in step 3) →
     never leave it open for that: an open ticket with a merged PR must mean
     « only a manual check is left ». Each leftover point gets three lines:
     what is left, why not now, what it would take. Then:
     - Direct mode: create the follow-up ticket (`write-ticket`, follow-up
       template; « Fini quand » = the unticked boxes as written in this
       ticket), attach it and carry the links over as that template says, in
       this ticket replace each moved box by
       `- [x] ~~<case>~~ → déplacée vers #M`, comment « suite dans #M », then
       apply outcome 1 or 2 to what remains.
     - Agent mode: leave the leftover boxes unticked and the ticket open,
       and list each leftover point under « reste » in the report, with its
       three lines. The orchestrator checks the merge, creates the follow-up,
       moves the boxes, comments this ticket and closes it (or « à valider »
       if a manual check remains); you create and close no ticket. A
       security box that goes to « reste » is already named in your
       « PRÊT À FUSIONNER » report.
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
Suite : fermé | à valider (quoi vérifier, comment, qui) | reste : par point, la case, quoi, pourquoi pas maintenant, ce qu'il faudrait
Tickets révélés : titre + une ligne chacun
Risques / ce que je n'ai pas pu vérifier :
```

« Suite » can hold both « à valider » and « reste » (outcome 3 then 2).

In direct mode, end with what needs the user (boxes to check by eye,
decisions, revealed tickets to prioritise).
