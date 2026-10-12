#!/bin/sh
# PreToolUse(Bash): before a `git push`, block when a plugin under plugins/
# changed since the remote branch without a new version in its plugin.json.
# Claude Code only offers a plugin update when that version changes.
command=$(jq -r '.tool_input.command // ""')
printf '%s' "$command" | grep -Eq '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push' || exit 0

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
base=$(git rev-parse --verify --quiet '@{upstream}' || git rev-parse --verify --quiet origin/main) || exit 0

missing=""
for manifest in plugins/*/.claude-plugin/plugin.json; do
  dir=${manifest%/.claude-plugin/plugin.json}
  git diff --quiet "$base" HEAD -- "$dir" && continue
  old=$(git show "$base:$manifest" 2>/dev/null | jq -r '.version // ""')
  new=$(jq -r '.version // ""' "$manifest")
  # A plugin new on the remote needs no bump.
  [ -n "$old" ] && [ "$old" = "$new" ] && missing="$missing ${dir#plugins/} ($new)"
done

[ -z "$missing" ] && exit 0
echo "Push bloqué : plugin(s) modifié(s) sans nouvelle version :$missing. Augmente \"version\" dans plugins/<plugin>/.claude-plugin/plugin.json (et la mention de version du README et de la doc), commite, puis relance le push. Sans ça, /plugin ne propose pas la mise à jour." >&2
exit 2
