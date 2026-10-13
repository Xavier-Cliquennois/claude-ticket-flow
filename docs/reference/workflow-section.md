# The `## Workflow` section of CLAUDE.md

The per-project settings every ticket-flow skill reads, field by field, with
examples.

> Up to date as of 2026-10-13 (ticket-flow 0.4.0).

`setup-project` writes this section; you can also edit it by hand. Its first
line under the heading is a template marker, `<!-- ticket-flow workflow: 2 -->`:
the update band offers to run `setup-project` when a project's marker is
missing or lower than the plugin's (see
[skills.md](skills.md#update-band)). The number only moves when the template
changes in a way existing projects should pick up. Skills read
it by meaning, not by exact wording, so it can live in your own words and
language. Fields that do not apply are left out, never left as placeholders.

## Fields

| Field | Read by | Default without it |
|---|---|---|
| Tracker: GitHub issues of `owner/repo`, or Linear team / project | all | GitHub issues of the current repository |
| Board: GitHub Project `owner #n`, and its status options mapped to *to do*, *in progress*, *to validate*, *blocked*, *done*; extra fields to fill (e.g. Phase) | write-ticket, deliver-ticket, run-epic | no board |
| Mandatory labels beyond the standard ones | write-ticket | standard set only |
| Worktree and branch convention | deliver-ticket, run-epic (agent prompt) | `../<repo>-<N>`, branch from the ticket |
| Verify commands, in order | deliver-ticket, run-epic, write-ticket ("done when") | inferred from `package.json` / `pyproject.toml` |
| Browser check rule | deliver-ticket, run-epic | Chrome, then Playwright, else NOT DONE |
| Review rule | deliver-ticket, run-epic | `security-reviewer`, HIGH/MEDIUM in scope block |
| Merge flow (PR to main / PR to `dev` then release / local `--no-ff`) | deliver-ticket, run-epic | what git history suggests |
| Max parallel agents | run-epic | 3 |
| Exclusive resources (never two at once) | deliver-ticket, run-epic | none |
| Project delivery skill, if any | deliver-ticket (defers to it), run-epic | `deliver-ticket` |
| Docs location and rule | project-docs | `docs/`, same-commit rule |

## Example: GitHub issues and a Projects board

```markdown
## Workflow

### Tickets
- Tracking: GitHub issues of acme/shop.
- Board: GitHub Project acme #3 "Shop". Statuses: to do=`Todo`,
  in progress=`In Progress`, to validate=`In Review`, blocked=`Blocked`,
  done=`Done`. Fields to fill: none.
- Tickets are written with the `write-ticket` skill.
- Mandatory labels: a type, `model:opus|sonnet`, `taille:S|M` (no L: split).
- An epic carries the `epic` label; its children are sub-issues; blockers are
  "blocked by" links, not prose.

### Delivering a ticket
- Worktree: `git worktree add ../shop-<N> -b feat/<N>-<slug>`.
- Verify: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Browser (UI): Chrome first; Playwright if Chrome is closed or fails 2-3
  times; otherwise write "browser test NOT DONE" and why.
- Review: `security-reviewer` on the diff before any merge; HIGH/MEDIUM block;
  out-of-scope findings become `sécurité` tickets.
- Merge: PR to `main`, merge commit, after green CI.
- Closing: tick "done when" boxes as you go, comment what was checked, close
  it yourself when every box is ticked (`Closes #N` does nothing when the merge
  does not target the default branch); only a human check left → to validate;
  code left → a follow-up ticket, never a ticket left open; open revealed
  tickets.

### Epics
- Run with `run-epic`, in waves, **2 agents in parallel at most** (CI runs on
  this machine).
- Never two at once: `npm run e2e` (shared database).

### Documentation
- Docs live in `docs/` and follow `project-docs`; a change that makes a doc
  wrong updates it in the same commit.
```

## Example: Linear

```markdown
### Tickets
- Tracking: Linear, team `ABC`, project "Mobile".
- Labels: a type (`Bug`, `Feature`, `Improvement`), a model (group
  `Modèle IA`: `Opus` / `Sonnet`), a size (group `Taille`: `S` / `M`).
- An epic is a parent issue (children carry `parentId`) or a Linear project.
- Statuses: Todo → In Progress → Testing → Done; Blocked when stuck.
```

## Coexisting with existing sections

If `CLAUDE.md` already has sections about git, the tracker or verification,
`setup-project` keeps them as the reference and writes in `## Workflow` only
what they do not already say, pointing to them. Run `setup-project` again to
bring the section up to date; it shows the diff and does not commit.
