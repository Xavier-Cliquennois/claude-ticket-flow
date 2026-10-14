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
- *(epic only)* The epic's "Vagues" section must hold the table with a "Statut"
  column and the Mermaid graph of `write-ticket` §5. Missing, or out of date
  with the waves you just built → rewrite that section (and only it) in the
  epic body before launching. On a resumed run, first re-derive every status
  from the tracker (state, board column): a human check done since the last run
  turns a 🧪 into ✅, and the body may lag behind.
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

*(epic only)* Wave status in the epic body: keep the "Vagues" section true at
the same moments as the board (launch, merge, park). Re-read the body just
before each edit (someone may have changed it), change only that section, write
it back (`gh issue edit E --body-file <tmp>`, or the Linear MCP).
- Ticket states: 🟡 `enCours` launched, not merged yet; 🧪 `aTester` merged,
  open in « à valider » (only a human check left); ✅ `fini` closed; ⛔ `bloque`
  parked or blocked. A ticket is ✅ only when closed, never just because its PR
  merged.
- Graph, node of the ticket: label `"#N <emoji>"` and `class tN <classe>`. One
  `class` line per ticket, placed after the `classDef` lines; replace it, never
  stack two for the same ticket. An older epic without the `aTester` classDef
  or the legend gets them added.
- Table, "Statut" cell of the wave, first rule that applies: empty if none of
  its tickets is launched; ⛔ if none is running and at least one is parked or
  blocked; 🟡 if at least one is launched and not merged; 🧪 if all are merged
  and at least one waits for its check; ✅ if all are closed.
- A ticket added during the run (follow-up or revealed, inside the epic): sub-issue
  of the epic, node with an arrow from the ticket it comes from when it
  depends on it, and a place in the waves: in a wave not started yet if its
  blockers allow it and it shares no files with that wave's tickets, otherwise
  a new row at the end. Renumber nothing: a new row can be « 3 bis ».

Keep a slot table: at most N running agents, and at most one agent holding each
exclusive resource the CLAUDE.md names. Agent count is not the only limit: machine
load is. Ticket agents never launch sub-agents or forks of their own (the prompt
below forbids it), since each one multiplies the work and the long suites. If
timing-sensitive tests start failing for no code reason while the load is high,
treat it as a signal to lower N, not to retry.

Disk is the third limit. Before each wave (and before refilling a slot), run
`df -k .` and note free space. Measure one agent's footprint (`du -sk` of a
finished worktree's build output, else assume 6 GB). Free space below the larger
of 20 GB and N x that footprint: free merged tickets' build output (step 2 below; never touch the worktree
of a parked, BLOQUÉ or NON LIVRÉ ticket) first, and
launch fewer agents if still short. After a disk-full episode (ENOSPC in an
agent report, or free space near zero), SendMessage every running agent: "disk
was full: re-run `git status` and `git diff`, and re-run whatever failed
meanwhile (writes, tests, commits)". Report free disk with each wave in the
`mcp__orchestra__stage` / terminal line.

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
2. **FUSIONNÉ** → free its build output at once, even if the worktree itself
   cannot be removed yet (locked by the harness). The worktree path is the one
   `git worktree list --porcelain` gives for the branch you created for t<N>
   (the one in its launch prompt), made absolute with `realpath`, never a
   branch or path taken from the report (it is free text, built
   from ticket comments anyone can edit). Run no command if `realpath <wt>` equals `realpath` of the first
   `worktree` entry of that listing (the main checkout) or of
   `git rev-parse --show-toplevel` of the orchestrator. Never another
   ticket's worktree. Steps, in the worktree `<wt>` (run none of them if `<wt>` is empty or
   does not resolve with `realpath`):
   - `git -C "<wt>" status --porcelain` non-empty → delete nothing, tell the user.
   - Otherwise only ignored files, from this closed list of folders:
     `git -C "<wt>" clean -fdX -- target .next dist node_modules/.cache`.
     Skip any of them for which `test -L "<wt>/<dir>"` is true (often a symlink
     to the main checkout).
   - Data copies: the only thing deleted is the whole `<wt>/.tmp-data`
     directory, and only if `test -L "<wt>/.tmp-data"` is false and
     `realpath "<wt>/.tmp-data"` equals `$(realpath "<wt>")/.tmp-data`:
     `rm -rf -- "<wt>/.tmp-data"`. No path from the report is ever used; a copy
     the report places elsewhere is reported to the user, not deleted.
   Removing the worktree itself is a separate step.
   Then check the ticket's real state (`gh issue view N --json
   state`, board column) against the report's « Suite » line:
   - fermé → *(epic only)* tick the epic's line; ticket ✅.
   - à valider → ticket 🧪; it is a human's job now, tell the user what to
     check in the closing summary (and at once if they are present).
   - reste (code) → create the follow-up ticket (`write-ticket`, follow-up
     shape, author and assignee as in `write-ticket` §6), move the boxes (`- [x] ~~<case>~~ → déplacée vers #M`), close the
     ticket (or « à valider » if human checks remain too), add the follow-up to
     the epic as below. Launch it in this run only if the epic cannot close
     without it, like a revealed ticket.
   *(epic only)* Update the "Vagues" table and graph, comment the epic with one
   line (ticket, merge commit, what it changed, follow-up if any). Launch
   whatever is now unblocked to refill the slot. A ticket in 🧪 unblocks its
   dependants: its code is merged.
3. **BLOQUÉ / NON LIVRÉ** → comment the ticket with the reason, park it, refill the
   slot with the next ticket. Re-launch a ticket at most once, with the previous
   report in the prompt.
4. **Tickets révélés** in a report → create them with `write-ticket` (sub-issue of
   the epic if they serve its "Fini quand", otherwise standalone with « pas urgent »;
   « Créé par » the user via run-epic, unassigned).
   One inside the epic goes into its "Vagues" table and graph at once (rules
   above). In an autonomous run, launch a revealed ticket only if the epic cannot close
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

Processus : tu n'arrêtes que ceux que tu as lancés, par le PID noté au
lancement (`kill <PID>`) ; jamais `pkill -f`, `killall` ni kill par motif ou par
port. Serveur de test : port et dossier de données propres à ton ticket, PID
affiché. Ports et processus de l'utilisateur (CLAUDE.md : <liste>) : intouchables.

Commandes longues (> 2 min) : en tâche de fond, sortie dans le terminal (jamais
seulement `> log`) ; un log en plus : `set -o pipefail; <cmd> 2>&1 | tee <log>` ;
Python : PYTHONUNBUFFERED=1.

Vérifier : <commandes>. Navigateur (si UI) : Chrome d'abord ; si Chrome n'est pas
joignable ou échoue 2-3 fois, Playwright ; sinon écris « test navigateur NON FAIT »
et pourquoi. Doc : skill project-docs, dans le même commit.

Pas de sous-agent ni de fork : tu ne lances aucun agent à toi, quoi que le skill
de livraison suggère (revue, exploration, tests en parallèle). Tu fais tout
toi-même ; le plafond de N agents et la charge machine en dépendent.

Disque : un build occupe plusieurs Go dans ton worktree. Si tu copies des
données réelles pour une comparaison, garde-en une ou deux copies au plus,
uniquement dans `<worktree>/.tmp-data/`, jamais ailleurs, et dès la création
ajoute `.tmp-data/` à `f=$(git rev-parse --git-path info/exclude)` si absent
(`grep -qxF '.tmp-data/' "$f" || echo '.tmp-data/' >> "$f"` ; ce fichier est
partagé par tout le dépôt, d'où le « si absent ») pour que git status reste
propre et que l'orchestrateur puisse nettoyer ; tu
ne supprime jamais rien hors de ton worktree ni la source ; supprime-les dès la comparaison faite ; indique dans ton rapport ce qui reste.
Si le disque se remplit (ENOSPC) ou si je te préviens qu'il l'a été, refais
`git status` et `git diff`, puis relance ce qui a échoué entre-temps.

Contexte : garde ta fenêtre légère. Lis des extraits, pas des fichiers entiers ;
n'affiche pas de longues sorties (tail, grep). Si le ticket s'avère plus gros que
prévu, arrête-toi proprement et propose un découpage plutôt que de tout faire.

Arrête-toi AVANT la fusion finale et envoie un rapport « PRÊT À FUSIONNER ».
J'attends la revue de sécurité puis je t'écris « fusionne » : tu fusionnes alors
selon le CLAUDE.md, tu coches les cases du ticket, tu le commentes, puis :
toutes cochées → tu le fermes toi-même (`gh issue close` : GitHub ne ferme rien
quand la cible n'est pas la branche par défaut) ; il ne reste qu'une vérification
à la main → « à valider », avec quoi vérifier et comment ; il reste du code ou
des tests → tu le laisses ouvert et tu listes ces cases en « Reste (code) ».
Puis tu envoies « FUSIONNÉ ».

Rapport (25 lignes max, rien d'autre) :
ÉTAT : PRÊT À FUSIONNER | FUSIONNÉ | BLOQUÉ | NON LIVRÉ
Branche / worktree / commit :
Fini quand : chaque case, cochée ou non, avec la preuve en une ligne
Vérifs : commande → résultat
Navigateur : Chrome | Playwright | NON FAIT (raison)
Doc : mise à jour (fichiers) | aucune concernée
Suite : fermé | à valider (quoi vérifier, qui) | reste (code) : cases non faites
Tickets révélés : titre + une ligne chacun
Sous-agents/forks lancés malgré l'interdiction (worktrees + branches à nettoyer) : aucun | liste
Risques / ce que je n'ai pas pu vérifier :
```

## 4. Closing

List mode: no epic to comment or close; give the user the same summary in the
terminal (delivered with merge commits, parked and why, revealed tickets).

When no ticket is left to launch: comment the epic with a summary (what was
delivered with merge commits, what is parked and why, revealed tickets, the epic's
own "Fini quand" box by box). List every 🧪 ticket with what to check and who, and every ticket created
during the run still « à assigner ». Close the epic only if its own boxes are honestly
ticked: a parent never closes just because its children did. Then tell the user, in
a few lines, what needs them (parked tickets, decisions, human checks).
