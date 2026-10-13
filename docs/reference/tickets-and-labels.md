# Tickets, labels and the size gate

The ticket and epic templates, the standard labels, and how `write-ticket`
decides a ticket is too big and splits it.

> Up to date as of 2026-10-13 (ticket-flow 0.5.0).

## The size gate

A ticket must be deliverable by one agent in one session without its context
filling up. `write-ticket` scores every ticket on six signals:

| Signal | S | M | Too big → split |
|---|---|---|---|
| Files touched (excluding tests, i18n) | 1–3 | 4–8 | > 8 |
| Responsibilities (model, API, UI, migration, infra…) | 1 | 1–2 linked | ≥ 3 |
| "Done when" boxes | ≤ 3 | ≤ 6 | > 6 |
| Human time | < ½ day | ≤ 1 day | > 1 day |
| Open product / architecture decisions | 0 | 0 (decided in the ticket) | any undecided |
| Exploration needed before coding | none | one known area | "find out where/why" |

Any signal in the last column means split. There is no size L.

### How tickets are split, in order of preference

1. **Decide first**: undecided questions become a short `model:opus` ticket
   whose "done when" is the decision written into the epic.
2. **Investigate first**: "find out why" becomes its own ticket ending with a
   measurement or a diagnosis, not a fix.
3. **Vertical slices**: each piece delivers something testable end to end (one
   screen, its route, its data), rather than all the API then all the UI.
4. **By layer**, only when a layer is a prerequisite (a migration others need).
5. **Mechanical bulk** (a rename across 40 files, an i18n sweep): one
   `model:sonnet` ticket per area, files listed.

Each piece must pass the gate on its own; the pieces become sub-issues of an
epic.

## Labels

Created by `setup-project` (only after you agree), idempotently; your existing
labels are never renamed or recolored.

| Label | Meaning |
|---|---|
| `model:opus` | Ambiguous architecture or product decision, intermittent bug, large scope the agent must decide itself, security-sensitive design |
| `model:sonnet` | The ticket says what to do and how to verify it |
| `epic` | Parent of a wave of sub-issues (optional in Linear) |
| `taille:S` | Under half a human day, 1-3 files |
| `taille:M` | One human day at most, one responsibility |
| `sécurité` | Touches auth, another user's data, untrusted input or secrets |

Plus a type label (`bug`, `feature`, …; GitHub's defaults are reused) and any
project-specific taxonomy you already have, which is kept and documented.
In Linear, the same labels live in a "Modèle IA" group and a "Taille" group.

## Templates

The templates are in French, the language of the author's projects. Claude
translates the headings when your project writes tickets in another language;
the English meaning is given here.

### Child ticket

| Heading | Meaning |
|---|---|
| `## Contexte` | Where it comes from: origin ticket, date, measured finding or screenshot; « Créé par : @login », the person to contact when something is unclear |
| `## Ce qu'on veut` | The expected outcome in one or two sentences; decisions already made |
| `## Fichiers probablement touchés` | Files likely touched, one line each (used to build waves) |
| `## Fini quand` | "Done when": a checklist checkable by someone else |
| `## Comment vérifier` | How to check: numbered steps, URL, action, expected result, 0 console errors |
| `## Hors périmètre` | Out of scope, and where it is tracked |
| `## Qui valide` | Who validates: the person who looks for visual work, an automated test where possible |

The "done when" list always includes the project's verify commands, the
browser check for UI work, and "docs up to date (or: no doc concerned)".
Security-sensitive tickets add "security-reviewer review with no HIGH/MEDIUM
finding". A box needing a human eye says so, so an unattended run does not
wait on it.

Titles state the finding or the outcome, with numbers when there are some,
never "Improve X".

### Epic

| Heading | Meaning |
|---|---|
| `## Pourquoi cet épic` | The problem and the number or user outcome that will say it is reached; « Créé par : @login » |
| `## Vagues` | Table (wave, tickets with model, waits for, why, status), critical path, a Mermaid graph of the blocked-by links and the legend 🟡 🧪 ✅ ⛔; same files never in one wave. `run-epic` fills the status as it runs |
| `## Hors de l'épic, exprès` | Deliberately out of the epic |
| `## Fini quand` | The epic's own criteria, not "all children closed" |

The children are not listed in the body: they are the epic's sub-issues, shown
by GitHub or Linear under the epic.

## Author and assignee

Every ticket and epic says who created it, in the body: « Créé par :
@login, le <date> », the person to contact when something is unclear. The
issue author is not enough: it does not say who relayed whose need, and
agents read the body. `deliver-ticket` asks that person, never guesses.

Before creating, `write-ticket` always asks who takes the ticket: you, someone
else, or nobody for now. It may have no name to suggest; the point is that
the question is never skipped. A split asks once (same person for all, ticket
by ticket, nobody).

Tickets `run-epic` creates while agents run cannot ask: they are « Créé par »
the user who launched the run, « via run-epic ». A follow-up keeps the
assignee of the ticket it continues; a revealed ticket stays unassigned and is
listed « à assigner » in the closing summary.

## Where tickets go

- **GitHub**: `gh issue create` (with `--assignee` when someone takes it); sub-issue and blocked-by links with GraphQL
  (`addSubIssue`, `addBlockedBy`, node ids from `gh issue view N --json id`).
- **GitHub Projects**: `gh project item-add` (idempotent: on an issue already
  on the board it returns the existing item, which is also how to find it),
  then `gh project item-edit` for Status and custom fields.
- **Linear**: `save_issue` through the Linear MCP, `parentId` for children,
  `relatedTo` for carve-outs.
