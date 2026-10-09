---
name: brainstorm
description: Facilitated brainstorming grounded in the current project - reads the code, docs, tickets and history, then runs a few creativity techniques with the user to find what to build next, what to improve, what to fix or drop; diverges first, then sorts ideas by impact/effort and turns the chosen ones into tickets. Use when the user says "brainstorm", "on réfléchit à la suite", "quoi faire de plus / de mieux", "des idées pour le projet", "où va le projet".
---

# brainstorm

You are a facilitator and a creative partner, not a questionnaire. Talk in the
user's language. The session has four phases; the user can say "suivant",
"on trie" or "stop" at any time and you follow.

Inspired by BMAD's brainstorming workflow, lighter: fewer techniques, chosen for
a software project, and grounded in what the repository actually contains.

## 1. Ground (before asking anything)

Read, quickly and in excerpts, to build a 10-line project brief:
- `CLAUDE.md`, `README.md`, `docs/README.md` and the docs it lists (headings only).
- Open tickets and epics (`gh issue list --limit 50`, the GitHub Project board, or
  Linear per the CLAUDE.md), and the last ~10 closed ones: what is planned, what
  keeps coming back, what is blocked.
- `git log --oneline -40` and `git log --since=60.days --name-only --format= | sort | uniq -c | sort -rn | head -20`
  (where the effort goes), `TODO`/`FIXME` counts, the biggest files.
- Previous sessions in `docs/brainstorms/` (don't re-propose what was already
  decided or dropped without saying so).
- The project memory notes, if any, for goals and constraints.

Show the brief (what it is, who it's for, where effort went, what is open, what
seems to hurt), then ask in ONE message:
- **Le sujet** : tout le projet, ou un axe (une fonctionnalité, la qualité,
  la performance, l'expérience utilisateur, le produit/business, l'outillage).
- **Le format** : express (~15 min, ~30 idées, 2 techniques) ou approfondi
  (~45 min, 60-100 idées, 3-4 techniques).
- **Les contraintes** : temps, budget, ce qui est hors de question.

## 2. Diverge

Pick techniques that fit the subject (propose 2-4 with one line each, the user
can swap). One technique at a time; one prompt at a time; build on the user's
answers ("oui, et…") and add your own ideas, clearly marked as yours.

| Technique | Good for | How |
|---|---|---|
| Frictions réelles | quality, UX | Walk the code hotspots, TODOs, reopened tickets, slow commands: "what hurts here, and what would remove it?" |
| Parcours utilisateur | features, UX | Follow one persona step by step through the product; at each step: what's missing, slow, confusing, delightful? |
| Jobs to be done | product | "When ___, I want to ___, so I can ___": list the jobs, find the ones the product half-does. |
| What if (×10, ÷10) | ambition, scope | 10× users, 10× data, a tenth of the budget, offline, mobile only, no backend: what breaks, what becomes possible? |
| Inversion | risk, quality | "How would we make this project fail / users leave / data leak?" then invert each answer. |
| Pre-mortem | roadmap | "In 6 months this failed. Why?" Each cause becomes an idea to prevent it. |
| SCAMPER | an existing feature | Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse, one letter at a time. |
| Premiers principes | architecture | Strip to what must be true; rebuild without the assumptions the code inherited. |
| Analogies | novelty | How does another domain (games, banking, sport, logistics) solve the same problem? |
| Chapeaux de Bono | decisions | Facts, feelings, risks, benefits, creativity, process: one pass per hat on one idea. |
| Concurrents et voisins | product | What do 3 comparable tools do that this one doesn't, and what does this one do they can't? |
| Supprimer | focus | "What could we delete, and who would notice?" Features, code, steps, tickets. |

Rules while diverging:
- **Quantity before judgment.** No "but" until phase 3; the first ~20 ideas are
  the obvious ones.
- **Change domain every ~10 ideas**: after technical ideas, go to users, then
  business, then operations/security, then the wild ones. Say when you pivot.
- **Ground each idea**: name the file, ticket, doc or user moment it touches
  when there is one; that is what makes this project's brainstorm different
  from a generic one.
- Capture each idea in one line as you go: `#n [thème] Titre court : une phrase.`
- Every ~10 ideas, show the running count and ask "on creuse celle-là, on
  change de technique, ou on trie ?"

## 3. Converge

When the user says so (or the format's budget is reached):
1. Group ideas into 4-8 themes; merge duplicates.
2. Score each idea: **Impact** (1-3), **Effort** (1-3), **Confiance** (1-3, how
   sure we are it works / is wanted). Show a table sorted by impact/effort.
3. Sort into: **Quick wins** (impact ≥ 2, effort 1), **Paris** (impact 3, effort
   ≥ 2), **À creuser** (low confidence: needs a measurement or a user check
   first), **Abandonnées** (say why, in one line).
4. Ask the user to pick 3-5 to act on. Challenge each pick once: what would
   prove it was worth it?

## 4. Capture and hand off

- Write the session to `docs/brainstorms/AAAA-MM-JJ-<sujet>.md`: the brief, the
  techniques used, all ideas (numbered, grouped), the scoring table, the picks
  with their "proof", and what was dropped and why. Follow `project-docs` rules
  (no secrets, real paths). Don't commit unless asked.
- For each pick, offer to create the ticket(s) with `write-ticket` (the size gate
  applies: a "pari" usually becomes an epic with a first "décider" or
  "mesurer" ticket). Create nothing without the user's yes.
- End with three lines: what was decided, what was created, what is left open.
