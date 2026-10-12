# claude-ticket-flow

A Claude Code marketplace with two plugins: `plugins/ticket-flow` (skills,
agent, hook) and `plugins/orchestra` (mod). User docs live in `docs/`.

## Releasing a plugin change

- **Bump the version before every push that touches a plugin.** Claude Code
  only offers `/plugin` updates when `version` in
  `plugins/<plugin>/.claude-plugin/plugin.json` changes: a push without a bump
  never reaches installed sessions.
- Semver: new behaviour or a visible change → minor (`0.3.0` → `0.4.0`), a fix
  → patch (`0.3.0` → `0.3.1`).
- In the same commit, update the versions quoted in `README.md` ("Up to date
  as of …") and in the plugin's page under `docs/reference/`.
- The project hook `.claude/hooks/require-version-bump.sh` blocks a
  `git push` when a plugin changed since the remote branch with the same
  version.

## Checks

```
claude plugin validate plugins/orchestra
cd plugins/orchestra && claude plugin test .
```

`plugins/orchestra/preview/index.html` simulates the orchestra pane; change it
together with the `ui.render` hook of `plugins/orchestra/hooks/register.tsx`.
