#!/bin/sh
# PreToolUse(Bash): before a `git commit`, remind the model to sync the docs.
# The tool input arrives as JSON on stdin (not in an env var).
input=$(cat)
printf '%s' "$input" | grep -q '"command"[^}]*git commit' || exit 0
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Avant ce commit : la doc décrit-elle encore le code commité ? Vérifie README.md, docs/, CLAUDE.md et la mémoire du projet contre les changements, et mets à jour ce qui est faux dans CE commit (skill project-docs : Mermaid pour les flux, SVG pour l'espace). Si aucune doc n'est concernée, continue."}}
JSON
