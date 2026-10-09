---
name: run-epic
description: Orchestrate an epic, or a plain list of tickets, (GitHub issues + Project board, or Linear) from one session - check every child passes the size gate, launch one background subagent per ticket in waves capped at the project's max parallel agents, refill freed slots, gate every merge on the security-reviewer agent, merge one at a time, tick boxes, open revealed tickets, report progress. Use when the user says "lance l'épic N", "attaque l'épic", "fais tourner la vague", "nuit autonome sur l'épic", "lance les tickets 12, 14 et 17", "fais tourner ces tickets", "lance le ticket 42 en fond".
---

# run-epic

You are the orchestrator. Your context is the scarce resource: you never read
diffs, logs or code yourself; subagents do the work and send you short reports.
Talk to the user in their language.

## 0. Read the frame

- Project `CLAUDE.md`, section `## Workflow`: tracker, **max parallel agents** (N;
  default 3 if absent), merge flow, verify commands, what must never run twice at
  once (bench, OCR, CI lock), the project's delivery skill if any (without one, ticket agents follow
  `ticket-flow:deliver-ticket`).
- Which epic: the one the user named (`#N`, a Linear id like `ABC-N`, a Linear project, or a plain
  list of tickets to run together). None named → list candidates (open parents,
  issues labelled `epic`, Linear projects with open issues) and ask; never pick one.
  In Linear an epic is a parent issue or a project: no label needed.
- **List mode**: the user named tickets, not an epic (« lance les tickets 12, 14
  et 17 », or a single ticket to run in the background). Everything below
  applies to the list as if it were the epic's children, except what belongs
  to an epic: no epic line to tick or comment, no epic card to move, no epic to
  close (marked *(epic only)* below). Revealed tickets are standalone. One
  ticket to do in this session rather than in the background is
  `deliver-ticket`, not this skill.
- The epic and every child: body, comments, state, labels, sub-issues, blocked-by
  (`gh issue view N --json title,body,state,labels,comments` + GraphQL
  `subIssues` / `blockedBy`; or the Linear MCP).
- `git worktree list` and existing branches: a worktree for a ticket means work
  in progress to resume, not to recreate.
- Machine: `vm_stat` (free memory) and `ps` for heavy processes already running.

## 1. Pre-flight (before launching anything)

- Every open child must pass the size gate of `write-ticket`, carry
  `model:opus|sonnet` and a "Fini quand". Fix what is missing; split what is too
  big (new sub-issues, update the epic table). Do this BEFORE launching: a ticket
  too big for one agent is the main cause of agents that run out of context.
- Build the waves: blocked-by order, then no two tickets touching the same files in
  the same wave (use their "Fichiers probablement touchés").
- Tickets whose "Fini quand" needs a human eye (annotation, visual judgment,
  a product decision) are parked: they will not be launched unattended.
- Publish the plan in the terminal: waves, N, parked tickets, and the order you
  will merge in. If the user is present, wait for one "go"; if they asked for an
  autonomous run, go.

## 2. The loop

Board (GitHub Project or Linear status): keep it true as you go, using the state
mapping in the CLAUDE.md and the commands in `write-ticket` §6. Launched → « en
cours »; parked or blocked → « bloqué »; merged and waiting for a human check →
« à valider » (or « fini » if the board has no such state and every box is
ticked); closed → « fini ». *(epic only)* The epic card is « en cours » from launch to
closing.

Keep a slot table: at most N running agents, and at most one agent holding each
exclusive resource the CLAUDE.md names.

Launch a ticket when it is unblocked, its wave is reached, a slot is free, and no
running agent touches its files. Launch with the Agent tool:
`run_in_background: true`, `name: "t<N>"` (so SendMessage and the panel show it),
`model` from the label (`opus` / `sonnet`), `description: "#<N> <titre court>"`,
and the prompt below.

When an agent reports:
1. **PRÊT À FUSIONNER** → run the `security-reviewer` agent on its branch/worktree
   (background, `name: "sec-<N>"`).
   - BLOQUANT → SendMessage to `t<N>` with the findings, verbatim; it fixes, reports
     again, you re-review. Two BLOQUANT rounds in a row → park the ticket with a
     comment and tell the user.
   - OK / OK AVEC RÉSERVES → out-of-scope findings become `sécurité` tickets
     (`write-ticket`); then SendMessage `t<N>`: "fusionne". **One merge at a time**
     across the whole epic: the next "fusionne" waits until the previous agent
     reported FUSIONNÉ.
2. **FUSIONNÉ** → *(epic only)* tick the epic's line, comment the epic with one
   line (ticket, merge commit, what it changed); then check the agent closed or moved its ticket as the
   project requires. Launch whatever is now unblocked to refill the slot.
3. **BLOQUÉ / NON LIVRÉ** → comment the ticket with the reason, park it, refill the
   slot with the next ticket. Re-launch a ticket at most once, with the previous
   report in the prompt.
4. **Tickets révélés** in a report → create them with `write-ticket` (sub-issue of
   the epic if they serve its "Fini quand", otherwise standalone with « pas urgent »).
   In an autonomous run, launch a revealed ticket only if the epic cannot close
   without it.

Never call AskUserQuestion while agents run: a modal question stops refilling
slots for hours. Write the question as plain text, park what depends on it, keep
the other slots busy.

Progress visibility: at each state change, call `mcp__orchestra__stage` with a
one-line stage ("vague 2/3 · t265 relu · t266 en cours") if the tool exists (the
`orchestra` mod). Otherwise print that line in the terminal.

Waiting: subagents notify you when they finish. Do not poll them, do not read
their transcripts.

## 3. Prompt for a ticket agent

Fill every <...>; delete lines that do not apply.

```
Tu livres le ticket <#N / ABC-N> : « <titre> » (épic <#E>). Tu es t<N>.
Réponds-moi dans ma langue ; code, commentaires et commits suivent le CLAUDE.md.

À lire d'abord : CLAUDE.md du projet ; le ticket en entier (corps ET commentaires) ;
<notes de mémoire utiles>. Tu suis le skill <skill de livraison du projet, sinon
ticket-flow:deliver-ticket> en mode agent : ce prompt prime là où il en dit plus.

Périmètre : ce ticket seulement. Fichiers attendus : <liste>. Un besoin hors
périmètre devient une ligne « ticket révélé » dans ton rapport, pas du code.
En parallèle de toi : <t<M> sur <fichiers>> ; ne touche pas à leurs fichiers.

Worktree : <commande de création, ou celui qui existe déjà : reprends-le après avoir lu son état>.
Ressources : <ports/base dédiés ; verrou machine ; limite de workers de test>.

Commandes longues (> 2 min) : en tâche de fond, sortie dans le terminal (jamais
seulement `> log`) ; un log en plus : `set -o pipefail; <cmd> 2>&1 | tee <log>` ;
Python : PYTHONUNBUFFERED=1.

Vérifier : <commandes>. Navigateur (si UI) : Chrome d'abord ; si Chrome n'est pas
joignable ou échoue 2-3 fois, Playwright ; sinon écris « test navigateur NON FAIT »
et pourquoi. Doc : skill project-docs, dans le même commit.

Contexte : garde ta fenêtre légère. Lis des extraits, pas des fichiers entiers ;
n'affiche pas de longues sorties (tail, grep). Si le ticket s'avère plus gros que
prévu, arrête-toi proprement et propose un découpage plutôt que de tout faire.

Arrête-toi AVANT la fusion finale et envoie un rapport « PRÊT À FUSIONNER ».
J'attends la revue de sécurité puis je t'écris « fusionne » : tu fusionnes alors
selon le CLAUDE.md, tu coches les cases du ticket, tu le commentes/fermes/passes
en Testing comme le projet le veut, et tu envoies « FUSIONNÉ ».

Rapport (25 lignes max, rien d'autre) :
ÉTAT : PRÊT À FUSIONNER | FUSIONNÉ | BLOQUÉ | NON LIVRÉ
Branche / worktree / commit :
Fini quand : chaque case, cochée ou non, avec la preuve en une ligne
Vérifs : commande → résultat
Navigateur : Chrome | Playwright | NON FAIT (raison)
Doc : mise à jour (fichiers) | aucune concernée
Tickets révélés : titre + une ligne chacun
Risques / ce que je n'ai pas pu vérifier :
```

## 4. Closing

List mode: no epic to comment or close; give the user the same summary in the
terminal (delivered with merge commits, parked and why, revealed tickets).

When no ticket is left to launch: comment the epic with a summary (what was
delivered with merge commits, what is parked and why, revealed tickets, the epic's
own "Fini quand" box by box). Close the epic only if its own boxes are honestly
ticked: a parent never closes just because its children did. Then tell the user, in
a few lines, what needs them (parked tickets, decisions, human checks).
