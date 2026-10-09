---
name: setup-project
description: Set up or upgrade a project for the ticket-flow ticket-driven workflow - checks git repo, GitHub remote, ticket tracker (GitHub issues, GitHub Project board, or Linear) and labels, offers to create what is missing, then writes or brings up to date the project's CLAUDE.md with the standard "Workflow" section that write-ticket and run-epic read. Use when the user runs /setup-project, asks to "mettre en place / remettre à niveau le CLAUDE.md", or starts working in a repo that has no CLAUDE.md.
---

# setup-project

Goal: after this skill, the project has everything `write-ticket`,
`deliver-ticket` and `run-epic` need, and its `CLAUDE.md` says it in one standard
section. Talk to the user in their language. Write CLAUDE.md in the language it already
uses; for a new one, in the user's language (the templates below are in French:
translate the headings if needed).

Never create, push or publish anything outward-facing (repo, labels, project)
without the user's explicit yes in this run. Ask with AskUserQuestion, at most 4
questions per call, and batch them.

## 1. Inspect (read-only, no questions yet)

Run these and keep the answers:

- `git rev-parse --show-toplevel` (is it a repo?), `git branch --show-current`,
  `git branch -a`, `git log --oneline -15` (commit language and style),
  `git worktree list`.
- `git remote -v`, then `gh repo view --json nameWithOwner,visibility,defaultBranchRef,hasIssuesEnabled`
  (fails if no GitHub remote or `gh` not logged in: note which).
- `gh label list --limit 200`, `gh issue list --state all --limit 30 --json number,title,labels`.
- `.mcp.json` / `.claude/settings*.json`: is a Linear MCP declared?
- GitHub Projects (v2): `gh project list --owner <owner> --format json`, and for the
  candidate(s) `gh project field-list <n> --owner <owner> --format json` (Status
  options, custom single-select fields such as Phase). A project whose title matches
  the repo, or whose items come from it, is the likely board. Needs the `project`
  scope (`gh auth refresh -s project` if missing).
- Existing `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `README.md`,
  `.claude/skills/`, `.claude/settings.json` hooks, `.github/workflows/`.
- Stack detection: `package.json` scripts, `pyproject.toml`, `pyrightconfig.json`,
  `Makefile`, test folders. Derive the real verify commands from them, never invent.
- Is there a web UI to test in a browser (Next.js, Vite, a `viz/` page...)?
- Memory dir for this project (`~/.claude/projects/<slug>/memory/MEMORY.md`), if any:
  notes about workflow there are facts to carry into CLAUDE.md.

## 2. Report and ask

Show a short status table: what exists, what is missing, what is stale
(e.g. CLAUDE.md pointing at a file that no longer says what it claims). Then ask
only what you could not infer:

- No git repo → offer `git init` (+ `.gitignore` for the stack).
- No GitHub remote → offer `gh repo create <name> --private --source . --push`
  (private by default; ask the name and the owner).
- Ticket tracker: GitHub issues (default), GitHub issues + a GitHub Project board,
  or Linear (if a Linear MCP exists or the user says so). For Linear, ask team and
  project. For a GitHub Project: confirm which board, then map its Status options
  onto the five workflow states (à faire, en cours, à valider, bloqué, fini); a
  state the board lacks is "—" (offer to add the option, e.g. « À tester »).
  No board yet → offer `gh project create --owner <owner> --title <name>` and
  `gh project link <n> --owner <owner> --repo <owner>/<repo>`.
- Merge flow: PR to the default branch / PR to `dev` then release PR /
  local `--no-ff` merge without PR. Propose what git history shows.
- Max parallel agents for `run-epic` (default 3; lower if benches or CI share the
  machine) and anything that must never run twice at once (heavy bench, OCR, CI lock).
- Domain labels specific to this project, if the user wants some.

## 3. Create what was approved

Labels are created idempotently (`gh label create ... --force` only for labels this
skill owns; never recolor or rename the user's existing labels). Standard set:

| Label | Color | Description |
|---|---|---|
| `model:opus` | `7B61FF` | Décision d'architecture/produit ambiguë, bug intermittent, gros périmètre à trancher soi-même |
| `model:sonnet` | `0E8A16` | Travail cadré : le ticket dit quoi faire et comment le vérifier |
| `epic` | `3E4B9E` | Parent d'une vague de sous-tickets |
| `taille:S` | `C2E0C6` | Moins d'une demi-journée humaine, 1 à 3 fichiers |
| `taille:M` | `FEF2C0` | Une journée humaine au plus, une seule responsabilité |
| `sécurité` | `B60205` | Touche auth, données d'un autre utilisateur, entrées non fiables ou secrets |

Plus a type label if the repo has none (`bug`, `feature`, `amélioration`, `doc`):
reuse GitHub's defaults when present. Keep project-specific taxonomies that
already exist (e.g. `gain`/`validation` or `phase:N` labels) and document
them; don't replace them.

For Linear, create the equivalent labels in a "Modèle IA" group and a "Taille"
group through the Linear MCP, only after a yes.

## 4. Write or upgrade CLAUDE.md

If there is no CLAUDE.md: write one with a short project header (what it is, stack,
where things live, 15 lines max) and the Workflow section below.

If one exists: **do not rewrite it**. Keep every project rule. Insert or replace
only the `## Workflow` section (match an existing equivalent section by meaning,
e.g. "Git", "Linear", "Vérifier avant de dire que c'est fini", and merge into it
rather than duplicating). Fix stale pointers you found. Show the diff
(`git diff CLAUDE.md`) and summarize it; do not commit unless asked.

The Workflow section, filled with the project's real values (delete lines that do
not apply, never leave placeholders):

```markdown
## Workflow

### Tickets
- Suivi : <GitHub issues de owner/repo | Linear, équipe X, projet Y>.
- Tableau : GitHub Project <owner> #<n> « <titre> ». Statuts : à faire=`<option>`,
  en cours=`<option>`, à valider=`<option|—>`, bloqué=`<option>`, fini=`<option>`.
  Champs à remplir : <Phase, ... | aucun>.
- Un ticket s'écrit avec le skill `write-ticket` : gabarit, labels, découpage.
- Labels obligatoires : un type, `model:opus|sonnet`, `taille:S|M` (L n'existe pas : on découpe). <labels propres au projet>
- Un épic porte le label `epic` ; ses enfants sont des sous-issues ; les blocages passent par des liens « bloqué par », pas par une section en prose.

### Livrer un ticket
- Worktree : `git worktree add ../<repo>-<N> -b <branche>` ; branche `<convention>`.
- Vérifier : `<commandes réelles, dans l'ordre>`.
- Navigateur (si UI) : Chrome (`mcp__claude-in-chrome__*`) d'abord ; Playwright (`mcp__plugin_playwright_playwright__*`) si Chrome est fermé ou échoue 2-3 fois ; sinon écrire « test navigateur NON FAIT » et pourquoi.
- Revue : l'agent `security-reviewer` passe sur le diff avant toute fusion ; un constat HIGH/MEDIUM bloque la fusion ; un constat hors périmètre devient un ticket `sécurité`.
- Fusion : <PR vers X, merge commit | merge local --no-ff>. <règles de branche protégée>
- Clôture : cocher les cases « Fini quand » au fil de l'eau, commenter ce qui a été vérifié, fermer seulement quand tout est coché, ouvrir les tickets révélés.

### Épics
- Lancés avec le skill `run-epic`, par vagues, **<N> agents en parallèle au maximum**.
- <ce qui ne doit jamais tourner deux fois en même temps>
```

## 4b. Documentation

Run the `project-docs` skill in audit mode and include its table in your report.
Add to the Workflow section a `### Documentation` block: where docs live, that
they follow `project-docs` (Mermaid for flows, SVG for space), and that a change
updates its doc in the same commit. Moving or archiving docs waits for the
user's yes like everything else.

## 5. Finish

List what was created, what changed in CLAUDE.md, and what is left to
the user (commit, push, a decision they deferred). If `write-ticket`, `run-epic` or
the `security-reviewer` agent are missing, say so (they ship together in the `ticket-flow` plugin).
