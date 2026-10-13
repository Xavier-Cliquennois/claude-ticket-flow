/**
 * Update band: a row above the prompt that says when a newer version of this
 * plugin is published, and updates it in place with one button.
 *
 * Generic: the plugin's own settings come from `register.tsx`
 * (`UpdateBandConfig`).
 */
import type { EngineInterface, On } from 'claude-code'

export type UpdateBandConfig = {
  /** Marketplace name, as `/plugin marketplace list` shows it. */
  marketplace: string
  /** GitHub repository holding the marketplace, `owner/name`. */
  repo: string
  /** Path of this plugin's `plugin.json` in that repository. */
  manifestPath: string
  /** Branch users install from. Default `main`. */
  branch?: string
  /** Fetches the latest `plugin.json` from this URL instead of GitHub (tests). */
  latestUrl?: string
  /**
   * Also checks the project's CLAUDE.md: a `## Workflow` section without the
   * marker `<!-- <marker>: <current> -->` (or with a lower number) gets a line
   * offering to run `command`.
   */
  workflow?: { marker: string; current: number; command: string }
  /**
   * Stays silent (no band, no network) unless the session's project root is
   * this folder or inside it. `~` is the home folder.
   */
  workspace?: { dir: string }
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'updating'; step: string }
  | { kind: 'failed'; message: string }

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

// Module state: one copy per load. A reload (our own update included) starts
// it over, which is what we want: the new version reads itself afresh.
let config: UpdateBandConfig = { marketplace: '', repo: '', manifestPath: '' }
let installed: string | undefined
let latest: string | undefined
let workflowStale = false
let phase: Phase = { kind: 'idle' }
let bandDrawn = false
let checked = false
let active: boolean | undefined
let contextSent = false

/** True when dotted version `a` is lower than `b`. */
export function isOlder(a: string, b: string): boolean {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

function versionOf(json: string): string | undefined {
  try {
    const v = JSON.parse(json)?.version
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

/** Last useful line of a `claude ... --json` run: its `message`, or raw text. */
function failureText(stdout: string, stderr: string): string {
  const lines = `${stdout}\n${stderr}`.trim().split('\n').filter(Boolean)
  const last = lines[lines.length - 1] ?? 'échec sans message'
  try {
    return JSON.parse(last).message ?? last
  } catch {
    return last
  }
}

function manualSteps(name: string): string {
  const m = config.marketplace
  return `/plugin marketplace update ${m}, puis /plugin update ${name}@${m}, puis /reload-plugins`
}

function hasUpdate(): boolean {
  return !!installed && !!latest && isOlder(installed, latest)
}

async function fetchLatest($: EngineInterface): Promise<string | undefined> {
  const branch = config.branch ?? 'main'
  const url =
    config.latestUrl ??
    `https://raw.githubusercontent.com/${config.repo}/${branch}/${config.manifestPath}`
  try {
    const res = await $.http.fetch(url)
    if (res.ok) return versionOf(res.text)
  } catch {
    // Offline or refused: try gh below.
  }
  if (config.latestUrl) return undefined
  // Private repository: the GitHub CLI holds the user's credentials.
  try {
    const { exitCode, stdout } = await $.process.run(
      ['gh', 'api', '-H', 'Accept: application/vnd.github.raw',
        `repos/${config.repo}/contents/${config.manifestPath}?ref=${branch}`],
      { timeoutMs: 15000 },
    )
    return exitCode === 0 ? versionOf(stdout) : undefined
  } catch {
    return undefined
  }
}

async function checkWorkflow($: EngineInterface): Promise<void> {
  const wf = config.workflow
  if (!wf || !(await isActive($))) return
  let text: string
  try {
    text = await $.fs.read('CLAUDE.md')
  } catch {
    workflowStale = false
    return
  }
  if (!/^## Workflow\b/m.test(text)) {
    workflowStale = false
    return
  }
  const m = text.match(new RegExp(`<!--\\s*${wf.marker}:\\s*(\\d+)\\s*-->`))
  workflowStale = !m || Number(m[1]) < wf.current
}

/** Whether the session is where this plugin may speak (see `workspace`). */
async function isActive($: EngineInterface): Promise<boolean> {
  if (active !== undefined) return active
  const ws = config.workspace
  if (!ws) return (active = true)
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  // Windows paths compare with forward slashes; folders compare case-insensitively.
  const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const dir = norm(ws.dir.replace(/^~(?=[\\/]|$)/, home))
  const root = norm(await $.session.root())
  return (active = root === dir || root.startsWith(`${dir}/`))
}

async function check($: EngineInterface): Promise<void> {
  checked = true
  if (!(await isActive($))) return
  try {
    installed = versionOf(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
  } catch {
    // Keep what we had.
  }
  latest = (await fetchLatest($)) ?? latest
  await checkWorkflow($)
  $.ui.invalidate('ui.render')
}

/** Runs `claude <args>` with the session's environment (same config dir). */
async function runClaude($: EngineInterface, args: string[]) {
  const home = await $.env.get('HOME')
  const candidates = ['claude', `${home}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  let lastError: unknown
  for (const bin of candidates) {
    try {
      return await $.process.run([bin, ...args], { timeoutMs: 180000 })
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

async function update($: EngineInterface): Promise<void> {
  const steps: [string, string[]][] = [
    ['catalogue', ['plugin', 'marketplace', 'update', config.marketplace, '--json']],
    ['plugin', ['plugin', 'update', `${$.plugin.name}@${config.marketplace}`, '--json']],
  ]
  try {
    for (const [label, args] of steps) {
      phase = { kind: 'updating', step: label }
      $.ui.invalidate('ui.render')
      const { exitCode, stdout, stderr } = await runClaude($, args)
      if (exitCode !== 0) throw new Error(failureText(stdout, stderr))
    }
    phase = { kind: 'updating', step: 'rechargement' }
    $.ui.invalidate('ui.render')
    await $.store.set('updatedTo', latest)
    await $.command.run({ command: 'reload-plugins', args: '' })
  } catch (err) {
    phase = { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
    $.ui.invalidate('ui.render')
  }
}

async function onStart($: EngineInterface): Promise<void> {
  // A reload after our own update: say it worked, once.
  const updatedTo = await $.store.get('updatedTo')
  if (typeof updatedTo === 'string') {
    await $.store.delete('updatedTo')
    $.ui.toast(`${$.plugin.name} ${updatedTo} est chargé.`)
  }
  await check($)
}

export function registerUpdateBand(on: On, options: UpdateBandConfig): void {
  config = options

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    void onStart($)
    $.clock.every(CHECK_EVERY_MS, () => void check($))
    return started
  })

  // Re-read CLAUDE.md after each turn: setup-project may have just fixed it.
  on('turn.complete', async ($, e, next) => {
    const wasStale = workflowStale
    await checkWorkflow($)
    if (wasStale !== workflowStale) $.ui.invalidate('ui.render')
    return next(e)
  })

  // Surfaces without the band (VS Code, mobile): tell the model once.
  on('prompt.submit', async ($, e, next) => {
    if (bandDrawn || contextSent || !hasUpdate()) return next(e)
    contextSent = true
    const note =
      `The ${$.plugin.name} plugin is outdated (installed ${installed}, latest ${latest}). ` +
      `Tell the user once, in their language and plain words, how to update: ${manualSteps($.plugin.name)}.`
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The first draw checks when session.start has not (a load mid-session).
    if (!checked) void check($)
    const showUpdate = hasUpdate() || phase.kind !== 'idle'
    if (e.props.hasSurvey || (!showUpdate && !workflowStale)) return next(e)
    bandDrawn = true

    const { Box, Button, Text } = $.ui.resolve(e)
    const name = $.plugin.name
    const rows = []

    if (showUpdate) {
      if (phase.kind === 'updating') {
        rows.push(
          <Text key="u">
            ⏳ Mise à jour de {name} vers {latest} : {phase.step}…
            {e.props.isWorking ? ' (après cette réponse)' : ''}
          </Text>,
        )
      } else if (phase.kind === 'failed') {
        rows.push(
          <Box key="u" flexDirection="column">
            <Text color="red">✗ Mise à jour de {name} impossible : {phase.message}</Text>
            <Text dimColor>À la main : {manualSteps(name)}</Text>
          </Box>,
        )
      } else {
        // No cursor control in the mods API: a hover tint says the row is clickable.
        rows.push(
          <Box key="u" hover={{ backgroundColor: 'subtle' }}>
            <Text>
              ⬆ {name} {latest} disponible <Text dimColor>(installé : {installed})</Text>{' '}
            </Text>
            <Button key="update" label="Mettre à jour" variant="primary" onPress={() => update($)} />
          </Box>,
        )
      }
    }

    if (workflowStale && config.workflow) {
      rows.push(
        <Box key="w" hover={{ backgroundColor: 'subtle' }}>
          <Text>⚙ La section Workflow du CLAUDE.md date d'un ancien gabarit </Text>
          <Button key="workflow" label="Remettre à niveau" onPress={() => runWorkflowCommand($)} />
        </Box>,
      )
    }

    return <Box flexDirection="column">{rows}</Box>
  })
}

async function runWorkflowCommand($: EngineInterface): Promise<void> {
  if (config.workflow) await $.command.run({ command: config.workflow.command, args: '' })
}
