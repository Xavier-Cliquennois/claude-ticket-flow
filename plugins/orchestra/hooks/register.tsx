import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { AgentRow, ShellRow, Stage, Step, StepKind } from '../types'
import {
  AVATAR_COLUMNS,
  AVATAR_ROWS,
  FRAME_COUNT,
  HUES,
  avatarCells,
  avatarSvg,
  barSvg,
  bodyColor,
  hueColor,
  progressColors,
  progressSvg,
} from './avatar'

const PANE = 'orchestra'
const TICK_MS = 5000
// The avatars of running agents step to their next frame this often.
const FRAME_MS = 700
const DONE = new Set(['completed', 'failed', 'killed', 'idle'])

const stage = atom({ plugin: 'orchestra', key: 'stage' } as const, null)
const agents = atom({ plugin: 'orchestra', key: 'agents' } as const, {})
const shells = atom({ plugin: 'orchestra', key: 'shells' } as const, {})
const tick = atom({ plugin: 'orchestra', key: 'tick' } as const, 0)
const commandsOpen = atom({ plugin: 'orchestra', key: 'commandsOpen' } as const, false)
const frame = atom({ plugin: 'orchestra', key: 'frame' } as const, 0)
const bandHidden = atom({ plugin: 'orchestra', key: 'bandHidden' } as const, false)

// Steps kept per agent: the newest is drawn in full, the others after it.
const KEPT_STEPS = 3

const KIND_COLOR: Record<StepKind, string> = {
  commande: '#ca8a04',
  lecture: '#16a34a',
  écriture: '#d97757',
  recherche: '#0891b2',
  web: '#0ea5e9',
  mcp: '#2563eb',
  agent: '#db2777',
  outil: '#78716c',
}

// Desktop sizes, in CSS pixels: the avatar at 5 pixels a sprite pixel.
const AVATAR_PX_W = AVATAR_COLUMNS * 5
const AVATAR_PX_H = AVATAR_ROWS * 2 * 5
const GAUGE_PX_W = 80
const GAUGE_PX_H = 8

// Commands kept in the pane: every running one, plus the latest ended ones.
const KEPT_SHELLS = 12
const TAIL_LINES = 3
// Commands listed when the COMMANDES block is unfolded.
const SHOWN_SHELLS = 3
const TAIL_BYTES = 4096

const pad2 = (n: number): string => String(n).padStart(2, '0')

const clockText = (ms: number): string => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const durationText = (ms: number): string => {
  const min = Math.floor(ms / 60000)
  if (min < 1) return `${Math.floor(ms / 1000)} s`
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${pad2(min % 60)}`
}

// Stage text and agent descriptions come from the model: strip C0/C1 control
// characters (ESC included) so nothing can drive the terminal that shows them.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const clean = (text: string): string => text.replace(CONTROL, ' ')

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

// An agent's label is "<name> · <task>"; a bare description is its own task.
const nameOf = (label: string): string => (label.includes(' · ') ? (label.split(' · ')[0] ?? label) : '')
const taskOf = (label: string): string => (label.includes(' · ') ? label.slice(label.indexOf(' · ') + 3) : label)

// Effort figures, integers only: a token count past 10 000 in thousands, past
// 10 000 000 in millions.
const tokensText = (n: number): string => {
  const whole = Math.max(0, Math.round(n))
  if (whole < 10_000) return String(whole)
  if (whole < 10_000_000) return `${Math.round(whole / 1000)} k`
  return `${Math.round(whole / 1_000_000)} M`
}
const callsText = (n: number): string => `${n} appel${n > 1 ? 's' : ''}`

const isFailed = (row: AgentRow): boolean => row.status === 'failed' || row.status === 'killed'

const baseName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path
const field = (e: Record<string, unknown>, key: string): string => (typeof e[key] === 'string' ? (e[key] as string) : '')

// A tool call as the pane tells it: its kind and its main argument.
function describeStep(tool: string, e: Record<string, unknown>, at: number): Step {
  const step = (kind: StepKind, text: string): Step => ({ kind, text: cut(clean(text).replace(/\s+/g, ' ').trim(), 80), at })
  if (tool === 'Bash') return step('commande', field(e, 'description') || field(e, 'command'))
  if (tool === 'Read') return step('lecture', baseName(field(e, 'file_path')))
  if (tool === 'Grep' || tool === 'Glob') return step('recherche', field(e, 'pattern'))
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return step('écriture', baseName(field(e, 'file_path')))
  if (tool === 'NotebookEdit') return step('écriture', baseName(field(e, 'notebook_path')))
  if (tool === 'WebSearch') return step('web', field(e, 'query'))
  if (tool === 'WebFetch') {
    const url = field(e, 'url')
    return step('web', url.replace(/^https?:\/\//, '').split('/')[0] ?? url)
  }
  if (tool === 'Agent' || tool === 'Task') return step('agent', field(e, 'description'))
  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')
    return step('mcp', `${server} · ${name.replace(/_/g, ' ')}`)
  }
  return step('outil', tool)
}

// "claude-opus-5-5" reads "opus 5.5"; an unknown name is kept as is.
const shortModel = (model: string): string => {
  const match = model.match(/(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/)
  if (match === null) return model
  return match[3] === undefined ? `${match[1]} ${match[2]}` : `${match[1]} ${match[2]}.${match[3]}`
}

const GAUGE_CELLS = 10
const ctxColor = (pct: number): string => (pct >= 40 ? 'red' : pct >= 30 ? 'yellow' : 'green')

// A command's output: drop escape sequences, keep what a carriage return
// left on screen (progress bars), then strip the remaining control characters.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?|\u001b[@-_]/g

const tailLines = (text: string, count: number): string[] =>
  text
    .replace(ANSI, '')
    .split('\n')
    .map(line => clean(line.split('\r').filter(part => part.trim() !== '').pop() ?? '').trimEnd())
    .filter(line => line.trim() !== '')
    .slice(-count)

// The background launch's answer names the file its output goes to.
const OUTPUT_PATH = /written to: (\S+\.output)/

// A background task's end reaches its loop as a <task-notification> row.
const NOTIFICATION = /<task-id>([\w-]+)<\/task-id>[\s\S]*?<status>(\w+)<\/status>/g

const endStatus = (status: string): ShellRow['status'] =>
  status === 'completed' ? 'completed' : status === 'killed' ? 'killed' : 'failed'

const keepRecent = (rows: Record<string, ShellRow>): Record<string, ShellRow> => {
  const ended = Object.values(rows)
    .filter(row => row.endedAt !== undefined)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  if (ended.length <= KEPT_SHELLS) return rows
  const kept: Record<string, ShellRow> = { ...rows }
  for (const row of ended.slice(KEPT_SHELLS)) delete kept[row.id]
  return kept
}

const endShell = (
  rows: Record<string, ShellRow>,
  match: (row: ShellRow) => boolean,
  status: ShellRow['status'],
  now: number,
): Record<string, ShellRow> => {
  let changed = false
  const updated: Record<string, ShellRow> = { ...rows }
  for (const row of Object.values(rows)) {
    if (row.endedAt === undefined && match(row)) {
      updated[row.id] = { ...row, status, endedAt: now }
      changed = true
    }
  }
  return changed ? keepRecent(updated) : rows
}

// The last lines of a background command's output file: read whole while
// small, through `tail` past what one read may copy.
async function readTail($: EngineInterface, path: string): Promise<string[] | undefined> {
  try {
    const { size } = await $.fs.stat(path)
    if (size <= 1024 * 1024) return tailLines(await $.fs.read(path), TAIL_LINES)
    const { stdout } = await $.process.run(['tail', '-c', String(TAIL_BYTES), path])
    return tailLines(stdout, TAIL_LINES)
  } catch {
    return undefined
  }
}

let shellSeq = 0

// What one event adds to a subagent's row: effort, a step, its model.
type Effort = { toolCalls: number; tokens: number; step?: Step; model?: string; effort?: string }
// What came in for a subagent before the tick has listed it (its first
// requests come before the first tick): merged into its row once listed.
type Pending = { toolCalls: number; tokens: number; steps: Step[]; model?: string; effort?: string }

const withSteps = (steps: Step[] | undefined, step: Step | undefined): Step[] | undefined =>
  step === undefined ? steps : [...(steps ?? []), step].slice(-KEPT_STEPS)

// Bounded: a loop never listed (a workflow's) would otherwise stay forever,
// so past MAX_PENDING ids the oldest one is dropped.
const MAX_PENDING = 200
const pendingEffort = new Map<string, Pending>()

async function addEffort($: EngineInterface, id: string, effort: Effort, lastTool?: string): Promise<void> {
  if ((await read($, agents))[id] === undefined) {
    const pending = pendingEffort.get(id) ?? { toolCalls: 0, tokens: 0, steps: [] }
    if (!pendingEffort.has(id) && pendingEffort.size >= MAX_PENDING) {
      const oldest = pendingEffort.keys().next().value
      if (oldest !== undefined) pendingEffort.delete(oldest)
    }
    pendingEffort.set(id, {
      toolCalls: pending.toolCalls + effort.toolCalls,
      tokens: pending.tokens + effort.tokens,
      steps: withSteps(pending.steps, effort.step) ?? [],
      model: effort.model ?? pending.model,
      effort: effort.effort ?? pending.effort,
    })
    return
  }
  await update($, agents, rows => {
    const row = rows[id]
    if (row === undefined) return rows
    return {
      ...rows,
      [id]: {
        ...row,
        toolCalls: (row.toolCalls ?? 0) + effort.toolCalls,
        tokens: (row.tokens ?? 0) + effort.tokens,
        steps: withSteps(row.steps, effort.step),
        model: effort.model ?? row.model,
        effort: effort.effort ?? row.effort,
        ...(lastTool === undefined ? {} : { lastTool }),
      },
    }
  })
}

// True while an agent runs: the avatars' frame moves only then.
let isAnyRunning = false

// Window size of the session's model, used to turn a subagent's input
// tokens into a percentage (subagents usually run a model of the same window).
let windowTokens = 200000
let isPaneOpened = false

async function openPane($: EngineInterface): Promise<void> {
  if (isPaneOpened) return
  isPaneOpened = true
  // Best effort: a session with no surface to draw on (claude -p) has no pane,
  // and the stage and agent tracking must keep working without it.
  try {
    await $.ui.open({ id: PANE, title: 'Orchestra' })
  } catch {
    isPaneOpened = false
  }
}

// The run's progress: a gradient bar, then "done/total tickets". `columns`
// is the room the whole row may take.
function progressRow(table: Elements[keyof Elements], isTerminal: boolean, done: number, total: number, columns: number) {
  const { Box, Text } = table
  const label = ` ${done}/${total} ticket${total > 1 ? 's' : ''}`
  const fraction = total === 0 ? 0 : done / total
  const cells = Math.max(4, Math.min(40, columns - label.length - 1))
  if (!isTerminal && 'Svg' in table) {
    const { Svg } = table
    const px = cells * 7
    return (
      <Box flexDirection="row">
        <Svg source={progressSvg(fraction, px, 10)} alt={`${done} sur ${total} tickets`} width={px} height={10} />
        <Text bold>{label}</Text>
      </Box>
    )
  }
  const filled = Math.round(fraction * cells)
  return (
    <Box flexDirection="row">
      {progressColors(filled).map(color => (
        <Text color={color}>█</Text>
      ))}
      <Text dimColor>{'░'.repeat(cells - filled)}</Text>
      <Text bold>{label}</Text>
    </Box>
  )
}

let lastStatusLine: string | undefined

// Writes the orchestrator's one-line summary where the status line command
// reads it: ~/.claude/state/orchestra/<session id>.txt (empty when idle).
async function writeStatusLine($: EngineInterface, text: string): Promise<void> {
  if (text === lastStatusLine) return
  const home = await $.env.get('HOME')
  if (home === undefined) return
  const sessionId = await $.session.id()
  try {
    await $.fs.write(`${home}/.claude/state/orchestra/${sessionId}.txt`, text)
    lastStatusLine = text
  } catch {
    // Best effort: the pane still shows everything.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'orchestra',
      description: "Ouvre le panneau Orchestra : heure, étape de l'orchestrateur, sous-agents",
    })
    await $.tool.register({
      name: 'stage',
      description:
        "Publish the orchestrator's current stage in the Orchestra pane, the band above the prompt and the status line, one short line (e.g. 'vague 2/3 · t265 relu · t266 en cours'). Call it at every state change of an epic run. Pass done and total (tickets merged, tickets in the run) to draw the run's progress bar.",
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The stage, one line' },
          done: { type: 'integer', minimum: 0, description: 'Tickets merged so far' },
          total: { type: 'integer', minimum: 1, description: 'Tickets in the run' },
        },
        required: ['text'],
      },
      isDeferred: false,
    })

    $.clock.every(FRAME_MS, async () => {
      if (isAnyRunning) await update($, frame, n => (n + 1) % FRAME_COUNT)
    })

    $.clock.every(TICK_MS, async () => {
      const now = await $.clock.now()
      const usage = await $.session.usage()
      windowTokens = usage.context.window
      const list = await $.agent.list()
      isAnyRunning = list.some(info => !DONE.has(info.status))
      await update($, agents, rows => {
        const merged: Record<string, AgentRow> = { ...rows }
        for (const info of list) {
          const row: AgentRow = merged[info.id] ?? {
            id: info.id,
            label: clean(info.name ?? info.description),
            type: info.type,
            status: info.status,
            startedAt: now,
            compactions: 0,
            hue: Object.keys(merged).length % HUES.length,
          }
          const isDone = DONE.has(info.status)
          const pending = pendingEffort.get(info.id)
          merged[info.id] = {
            ...row,
            toolCalls: (row.toolCalls ?? 0) + (pending?.toolCalls ?? 0),
            tokens: (row.tokens ?? 0) + (pending?.tokens ?? 0),
            steps: [...(row.steps ?? []), ...(pending?.steps ?? [])].slice(-KEPT_STEPS),
            model: row.model ?? pending?.model,
            effort: row.effort ?? pending?.effort,
            label: clean(info.name ? `${info.name} · ${info.description}` : info.description),
            status: info.status,
            endedAt: isDone ? (row.endedAt ?? now) : undefined,
          }
        }
        // An agent the engine dropped from its list has finished.
        const listed = new Set(list.map(info => info.id))
        for (const id of Object.keys(merged)) {
          const row = merged[id]
          if (row !== undefined && !listed.has(id) && row.endedAt === undefined) {
            merged[id] = { ...row, endedAt: now }
          }
        }
        return merged
      })
      for (const info of list) pendingEffort.delete(info.id)
      if (list.length > 0) await openPane($)

      // Refresh the running background commands' output, and end those that
      // died with the subagent that started them.
      const agentRows = await read($, agents)
      const shellRows = Object.values(await read($, shells))
      const tails = new Map<string, string[]>()
      for (const row of shellRows) {
        if (row.endedAt !== undefined || row.outputPath === undefined) continue
        const lines = await readTail($, row.outputPath)
        if (lines !== undefined) tails.set(row.id, lines)
      }
      await update($, shells, rows => {
        let updated = rows
        for (const [id, lines] of tails) {
          const row = updated[id]
          if (row !== undefined) updated = { ...updated, [id]: { ...row, tail: lines } }
        }
        return endShell(
          updated,
          row =>
            row.endsWithOwner === true &&
            row.agentId !== undefined &&
            agentRows[row.agentId]?.endedAt !== undefined,
          'killed',
          now,
        )
      })

      // The status line (ccstatusline) shows this file: the engine's own pinned
      // status is plain text behind a warning glyph, so it is not used.
      const current = await read($, stage)
      const runningCount = list.filter(info => !DONE.has(info.status)).length
      const shellCount = Object.values(await read($, shells)).filter(row => row.endedAt === undefined).length
      const parts: string[] = []
      if (current !== null) {
        const progress = current.total === undefined ? '' : ` (${current.done ?? 0}/${current.total})`
        parts.push(`▶ ${current.text}${progress}`)
      }
      if (runningCount > 0) parts.push(`${runningCount} agent${runningCount > 1 ? 's' : ''} actif${runningCount > 1 ? 's' : ''}`)
      if (shellCount > 0) parts.push(`${shellCount} commande${shellCount > 1 ? 's' : ''}`)
      await writeStatusLine($, parts.join(' · '))
      await update($, tick, n => n + 1)
    })

    return next(e)
  })

  on('command.run', { command: 'orchestra' }, async $ => {
    isPaneOpened = false
    await openPane($)
    return { text: 'Panneau Orchestra ouvert.' }
  })

  on('tool.call', { tool: 'mcp__orchestra__stage' }, async ($, e) => {
    const text = typeof e.text === 'string' ? e.text : ''
    const count = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
    const done = count(e.done)
    const total = count(e.total)
    const hasProgress = done !== undefined && total !== undefined && total > 0
    const value: Stage = {
      text: cut(clean(text).trim(), 160),
      at: await $.clock.now(),
      ...(hasProgress ? { done: Math.min(done, total), total } : {}),
    }
    await update($, stage, () => value)
    await update($, bandHidden, () => false)
    await openPane($)
    return { result: 'Étape affichée.' }
  })

  // Remember each subagent's last tool and its latest steps, and count its
  // tool calls. Counting never stands in a tool call's way: a failure lets
  // the call run.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const step = describeStep(e.tool, e as unknown as Record<string, unknown>, await $.clock.now())
      await addEffort($, id, { toolCalls: 1, tokens: 0, step }, e.tool)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A subagent's context fill: the input tokens its latest request was
  // answered over; and its tokens, every request's input and output summed.
  on('turn.step', async function* ($, e, next) {
    const answered = yield* next(e)
    const id = e.agentId
    const usage = answered.usage
    if (id !== undefined && usage !== null) {
      const tokens =
        usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      await update($, agents, rows => {
        const row = rows[id]
        return row === undefined ? rows : { ...rows, [id]: { ...row, contextTokens: tokens } }
      })
      await addEffort($, id, {
        toolCalls: 0,
        tokens: tokens + usage.output_tokens,
        model: shortModel(e.model),
        effort: e.effort === undefined ? undefined : String(e.effort),
      })
    }
    return answered
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    if (id !== undefined && done.messages !== undefined) {
      await update($, agents, rows => {
        const row = rows[id]
        return row === undefined
          ? rows
          : { ...rows, [id]: { ...row, compactions: row.compactions + 1, contextTokens: undefined } }
      })
    }
    return done
  })

  // Every shell command, the main session's and each subagent's: shown while
  // it runs, a background one with the tail of its output file.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const id = e.tool_use_id ?? `shell-${++shellSeq}`
    const startedAt = await $.clock.now()
    const row: ShellRow = {
      id,
      agentId: e.agentId,
      description: cut(clean(e.description ?? '').trim(), 200),
      command: cut(clean(e.command).replace(/\s+/g, ' ').trim(), 400),
      isBackground: e.run_in_background === true,
      startedAt,
      status: 'running',
      tail: [],
    }
    await update($, shells, rows => ({ ...rows, [id]: row }))
    if (row.isBackground) await openPane($)

    const ran = await next(e)
    const now = await $.clock.now()
    const result = ran.deny === undefined && ran.isError !== true ? ran.result : undefined
    const taskId = result?.backgroundTaskId
    if (taskId !== undefined) {
      // Launched in the background, or moved there (ctrl+b, a timeout).
      const outputPath = ran.text?.match(OUTPUT_PATH)?.[1]
      await update($, shells, rows => {
        const current = rows[id] ?? row
        return {
          ...rows,
          [id]: {
            ...current,
            isBackground: true,
            taskId,
            outputPath,
            endsWithOwner: result?.backgroundEndsWithFinalResponse === true,
          },
        }
      })
      await openPane($)
    } else {
      const status: ShellRow['status'] = ran.deny !== undefined || ran.isError === true ? 'failed' : 'completed'
      await update($, shells, rows => endShell(rows, current => current.id === id, status, now))
    }
    return ran
    // Tracking must never cost the command: a failure here hands on the
    // call's own result (replayed, never run twice) or runs it untouched.
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const taskId = e.task_id ?? e.shell_id
    if (ran.deny === undefined && ran.isError !== true && taskId !== undefined) {
      const now = await $.clock.now()
      await update($, shells, rows => endShell(rows, row => row.taskId === taskId, 'killed', now))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A background command's end: its notification row names the task and how
  // it ended, in whichever loop (main or subagent) started it.
  on('session.append', async ($, e, next) => {
    const text = JSON.stringify(e.message.content)
    if (text.includes('task-notification')) {
      const ends = new Map<string, ShellRow['status']>()
      for (const match of text.matchAll(NOTIFICATION)) {
        const [, taskId, status] = match
        if (taskId !== undefined && status !== undefined) ends.set(taskId, endStatus(status))
      }
      if (ends.size > 0) {
        const now = await $.clock.now()
        const rows = Object.values(await read($, shells)).filter(
          row => row.taskId !== undefined && ends.has(row.taskId) && row.endedAt === undefined,
        )
        const tails = new Map<string, string[]>()
        for (const row of rows) {
          const lines = row.outputPath === undefined ? undefined : await readTail($, row.outputPath)
          if (lines !== undefined) tails.set(row.id, lines)
        }
        await update($, shells, current => {
          let updated = current
          for (const row of rows) {
            const kept = updated[row.id]
            if (kept === undefined) continue
            updated = { ...updated, [row.id]: { ...kept, tail: tails.get(row.id) ?? kept.tail } }
            updated = endShell(updated, other => other.id === row.id, ends.get(row.taskId ?? '') ?? 'failed', now)
          }
          return updated
        })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    await read($, tick)
    const step = await read($, frame)
    const now = await $.clock.now()
    const current = await read($, stage)
    const isOpen = await read($, commandsOpen)
    const rows = Object.values(await read($, agents))
    const running = rows.filter(row => row.endedAt === undefined).sort((a, b) => b.startedAt - a.startedAt)
    const ended = rows
      .filter(row => row.endedAt !== undefined)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    const failedCount = ended.filter(isFailed).length
    // Newest first; on a tie, the one recorded last.
    const shellRows = Object.values(await read($, shells))
      .reverse()
      .sort((a, b) => b.startedAt - a.startedAt)
    const runningShells = shellRows.filter(row => row.endedAt === undefined)
    const endedShells = shellRows
      .filter(row => row.endedAt !== undefined)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    // Room inside the pane's body (the viewport is wider while the pane is
    // docked beside the transcript), then inside the header frame.
    const width = Math.max(30, e.props.bodyColumns)
    const inner = width - 4
    let room = Math.max(8, e.props.scroll.bodyRows)

    const percentOf = (row: AgentRow): number | undefined =>
      row.contextTokens === undefined ? undefined : Math.round((100 * row.contextTokens) / windowTokens)
    const owner = (row: ShellRow): string => {
      if (row.agentId === undefined) return 'orchestrateur'
      const agent = rows.find(candidate => candidate.id === row.agentId)
      return agent === undefined ? 'sous-agent' : cut(nameOf(agent.label), 24)
    }
    // Only the latest command of a loop is drawn: the one it is waiting on.
    const latestRunning = (agentId: string | undefined): ShellRow | undefined =>
      runningShells.find(row => row.agentId === agentId)

    // One command: a coloured summary line, the command line under it, and
    // the last lines of its output (a running one) or its very last (ended).
    const shellLines = (row: ShellRow) => {
      const isDone = row.endedAt !== undefined
      const failed = row.status === 'failed' || row.status === 'killed'
      const mark = failed ? '✗' : isDone ? '✓' : '⏵'
      const summary = [
        owner(row),
        row.description === '' ? undefined : row.description,
        durationText((row.endedAt ?? now) - row.startedAt),
        row.isBackground ? 'fond' : undefined,
        isDone && row.status !== 'completed' ? row.status : undefined,
      ]
        .filter(part => part !== undefined)
        .join(' · ')
      const tail = isDone ? row.tail.slice(-1) : row.tail
      const room = width - 2
      return [
        <Text color={failed ? 'red' : isDone ? 'green' : 'yellow'} bold={!isDone} wrap="truncate-end">
          {mark} {cut(summary, room)}
        </Text>,
        <Text color="cyan" dimColor={isDone} wrap="truncate-end">
          {'  $ '}
          {cut(row.command, room - 2)}
        </Text>,
        ...tail.map(tailLine => (
          <Text dimColor wrap="truncate-end">
            {'  │ '}
            {cut(tailLine, room - 2)}
          </Text>
        )),
      ]
    }
    const shellHeight = (row: ShellRow): number => 2 + (row.endedAt === undefined ? row.tail.length : Math.min(1, row.tail.length))

    // A section title: bold label, dim count, a rule to the edge, cut rather
    // than wrapped when the pane is narrower than its viewport says.
    const rule = (head: string) => (
      <Text dimColor wrap="truncate">
        {'─'.repeat(Math.max(0, width - head.length - 1))}
      </Text>
    )
    const section = (label: string, count: number | undefined, color: string) => {
      const head = count === undefined ? label : `${label} · ${count}`
      return (
        <Box flexDirection="row" marginTop={1}>
          <Box flexShrink={0}>
            <Text bold color={color}>
              {head}{' '}
            </Text>
          </Box>
          {rule(head)}
        </Box>
      )
    }

    // The terminal draws cells; the other surfaces draw SVG.
    const isTerminal = e.surface === 'terminal'

    // A context gauge: green under 30 %, yellow from 30 %, red from 40 %.
    const GAUGE_HEX = { green: '#16a34a', yellow: '#eab308', red: '#dc2626' } as const
    const gauge = (pct: number) => {
      const color = ctxColor(pct) as keyof typeof GAUGE_HEX
      const label = (
        <Text color={color} bold>
          {' '}
          {pct} %
        </Text>
      )
      if (!isTerminal && 'Svg' in table) {
        const { Svg } = table
        return [
          <Svg
            source={barSvg(pct / 100, GAUGE_HEX[color], GAUGE_PX_W, GAUGE_PX_H)}
            alt={`contexte ${pct} %`}
            width={GAUGE_PX_W}
            height={GAUGE_PX_H}
          />,
          label,
        ]
      }
      const filled = Math.min(GAUGE_CELLS, Math.round((pct / 100) * GAUGE_CELLS))
      return [<Text color={color}>{'█'.repeat(filled)}</Text>, <Text dimColor>{'░'.repeat(GAUGE_CELLS - filled)}</Text>, label]
    }

    // An agent's little Claude in its own colour: cells on the terminal, SVG
    // elsewhere; it steps while the agent runs.
    const avatar = (row: AgentRow) => {
      const hue = row.hue ?? 0
      const body = bodyColor(hue, isFailed(row))
      const at = row.endedAt === undefined ? step : 0
      if (isTerminal && 'Raster' in table) {
        const { Raster } = table
        return <Raster key={`avatar-${row.id}`} columns={AVATAR_COLUMNS} rows={AVATAR_ROWS} cells={avatarCells(at, body)} />
      }
      if ('Svg' in table) {
        const { Svg } = table
        return <Svg source={avatarSvg(at, body)} alt={`avatar de ${nameOf(row.label) || 'l’agent'}`} width={AVATAR_PX_W} height={AVATAR_PX_H} />
      }
      return <Text color={body}>●</Text>
    }

    // Its latest steps, newest first: the newest in full with its kind in
    // colour, the older ones dim after it.
    const stepsLine = (row: AgentRow) => {
      const steps = [...(row.steps ?? [])].reverse()
      const [latest, ...older] = steps
      if (latest === undefined) return <Text dimColor>{row.lastTool ?? 'démarre…'}</Text>
      const trail = older.map(item => `‹ ${item.kind} ${item.text}`).join(' ')
      return (
        <Box flexDirection="row">
          <Box flexShrink={0}>
            <Text color={KIND_COLOR[latest.kind]} bold>
              ◆ {latest.kind}{' '}
            </Text>
          </Box>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">{latest.text}</Text>
          </Box>
          {trail !== '' && (
            <Box flexShrink={2}>
              <Text dimColor wrap="truncate-end">
                {'  '}
                {trail}
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    // A running agent: its avatar beside three lines: name, task and duration;
    // context gauge, model and effort; then the command it runs, or its steps.
    const card = (row: AgentRow) => {
      const elapsed = durationText(now - row.startedAt)
      const name = nameOf(row.label)
      const task = taskOf(row.label)
      const pct = percentOf(row)
      const shell = latestRunning(row.id)
      const hue = hueColor(row.hue ?? 0)
      const model = [row.model, row.effort].filter(part => part !== undefined && part !== '').join(' · ')
      const detail = [model === '' ? undefined : model, row.compactions > 0 ? `${row.compactions} compact.` : undefined]
        .filter(part => part !== undefined)
        .join(' · ')
      const textRoom = width - AVATAR_COLUMNS - 1
      const taskRoom = Math.max(4, textRoom - name.length - elapsed.length - 3)
      return (
        <Box flexDirection="row" marginTop={1}>
          <Box flexShrink={0} marginRight={1}>
            {avatar(row)}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row">
              <Box flexShrink={0}>
                <Text color={hue} bold>
                  {name === '' ? '●' : name}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text bold wrap="truncate-end">
                  {' '}
                  {cut(task, taskRoom)}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={hue}> {elapsed}</Text>
              </Box>
            </Box>
            <Box flexDirection="row">
              <Box flexDirection="row" flexShrink={0}>
                <Text dimColor>{'ctx '}</Text>
                {pct === undefined ? [<Text dimColor>—</Text>] : gauge(pct)}
              </Box>
              {detail !== '' && (
                <Box flexShrink={1}>
                  <Text dimColor wrap="truncate-end">
                    {' · '}
                    {detail}
                  </Text>
                </Box>
              )}
            </Box>
            {shell === undefined ? (
              stepsLine(row)
            ) : (
              <Text color="yellow" bold wrap="truncate-end">
                ⏵ {shell.description === '' ? shell.command : shell.description} · {durationText(now - shell.startedAt)}
              </Text>
            )}
          </Box>
        </Box>
      )
    }
    const CARD_HEIGHT = 4

    // An ended agent: one line, name, task, then its effort (duration, tool
    // calls, tokens) and context fill. The effort keeps the widest form that
    // leaves the task 8 columns; the context fill goes first when it does not.
    const nameWidth = Math.min(12, Math.max(0, ...ended.map(row => nameOf(row.label).length)))
    const endedLine = (row: AgentRow) => {
      const failed = isFailed(row)
      const pct = percentOf(row)
      const status = failed ? ` ${row.status}` : ''
      const duration = durationText((row.endedAt ?? now) - row.startedAt).padStart(7)
      const calls = String(row.toolCalls ?? 0)
      const tokens = tokensText(row.tokens ?? 0)
      const metaRoom = Math.max(0, width - nameWidth - status.length - 3 - 8)
      const metas = [
        `${duration} · ${calls.padStart(3)} appels · ${tokens.padStart(6)} tok`,
        `${duration} · ${calls.padStart(3)} app · ${tokens.padStart(6)}`,
        duration,
      ]
      const meta = metas.find(text => text.length <= metaRoom) ?? cut(duration.trim(), Math.max(1, metaRoom))
      const pctText = pct === undefined || meta.length + 6 > metaRoom ? '' : `${pct} %`.padStart(6)
      const taskRoom = Math.max(4, width - nameWidth - meta.length - pctText.length - status.length - 3)
      return (
        <Box flexDirection="row">
          <Box flexShrink={0}>
            <Text color={failed ? 'red' : 'green'}>{failed ? '✗' : '✓'} </Text>
            <Text bold={failed} color={failed ? undefined : hueColor(row.hue ?? 0)}>
              {cut(nameOf(row.label), nameWidth).padEnd(nameWidth)}{' '}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {cut(taskOf(row.label), taskRoom)}
            </Text>
          </Box>
          <Box flexShrink={0}>
            {status !== '' && <Text color="red">{status}</Text>}
            <Text dimColor>{meta}</Text>
            <Text color={pct !== undefined && pct >= 30 ? ctxColor(pct) : undefined} dimColor={pct === undefined || pct < 30}>
              {pctText}
            </Text>
          </Box>
        </Box>
      )
    }

    // The block's title is its toggle: a click, or "c" while the pane has the focus.
    const toggle = () => {
      void update($, commandsOpen, open => !open)
    }
    const commandsHead = () => {
      const head = `${isOpen ? '▾' : '▸'} COMMANDES${runningShells.length > 0 ? ` · ${runningShells.length} en cours` : ''}`
      return (
        <Box flexDirection="row" marginTop={1}>
          <Box flexShrink={0}>
            <Button key="commands" label={head} plain hotkey="c" onPress={toggle}>
              <Text bold color="yellow">
                {head}
              </Text>
            </Button>
          </Box>
          <Text> </Text>
          {rule(head)}
        </Box>
      )
    }
    const commandsLine = () => {
      const row = runningShells[0] ?? endedShells[0]
      if (row === undefined) return undefined
      const isDone = row.endedAt !== undefined
      const failed = row.status === 'failed' || row.status === 'killed'
      const what = row.description === '' ? row.command : row.description
      const when = isDone
        ? `fini il y a ${durationText(now - (row.endedAt ?? now))}`
        : `depuis ${durationText(now - row.startedAt)}`
      const others = runningShells.length > 1 ? ` · +${runningShells.length - 1}` : ''
      return (
        <Text color={failed ? 'red' : isDone ? 'green' : 'yellow'} bold={!isDone} wrap="truncate-end">
          {cut(`${failed ? '✗' : isDone ? '✓' : '⏵'} ${owner(row)} · ${what} · ${when}${others}`, width)}
        </Text>
      )
    }

    const counts = [
      clockText(now),
      `${running.length} actif${running.length > 1 ? 's' : ''}`,
      `${ended.length - failedCount} fini${ended.length - failedCount > 1 ? 's' : ''}`,
      failedCount > 0 ? `${failedCount} en échec` : undefined,
    ]
      .filter(part => part !== undefined)
      .join(' · ')
    const stageText = current === null ? undefined : `▶ ${clean(current.text)}`
    const stageAge = current === null ? '' : ` ${durationText(now - current.at)}`
    room -= 3 + (stageText === undefined ? 1 : Math.ceil((stageText.length + stageAge.length) / inner))
    // The run's totals, running agents included: one line in the header.
    const totalCalls = rows.reduce((sum, row) => sum + (row.toolCalls ?? 0), 0)
    const totalTokens = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
    const totals =
      rows.length === 0
        ? undefined
        : cut(
            `Σ ${rows.length} agent${rows.length > 1 ? 's' : ''} · ${callsText(totalCalls)} · ${tokensText(totalTokens)} tok`,
            inner,
          )
    if (totals !== undefined) room -= 1
    const hasProgress = current?.total !== undefined
    if (hasProgress) room -= 1

    // Running agents first, whole; the ended ones fill what is left.
    const shownCards: AgentRow[] = []
    if (running.length > 0) room -= 2
    for (const row of running) {
      const height = CARD_HEIGHT
      if (height > room && shownCards.length > 0) break
      shownCards.push(row)
      room -= height
    }
    // The COMMANDES block. Folded, one line: the newest running command and
    // how long it has run, else the last one ended and how long ago. Unfolded,
    // the latest SHOWN_SHELLS, running first, each with its command line.
    const shownShells = isOpen ? [...runningShells, ...endedShells].slice(0, SHOWN_SHELLS) : []
    const hasShells = shellRows.length > 0
    if (hasShells) room -= 2 + (isOpen ? shownShells.reduce((sum, row) => sum + shellHeight(row), 0) : 1)
    const endedRoom = Math.max(1, room - 2)
    const shownEnded = ended.length > endedRoom ? ended.slice(0, Math.max(1, endedRoom - 1)) : ended

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color="claude" wrap="truncate-end">
              ORCHESTRA
            </Text>
            <Box flexShrink={0}>
              <Text bold>{counts}</Text>
            </Box>
          </Box>
          {stageText === undefined ? (
            <Text dimColor>Aucune étape publiée.</Text>
          ) : (
            <Box flexDirection="row">
              <Text bold color="claude">
                {stageText}
              </Text>
              <Text dimColor>{stageAge}</Text>
            </Box>
          )}
          {current !== null &&
            current.total !== undefined &&
            progressRow(table, isTerminal, current.done ?? 0, current.total, inner)}
          {totals !== undefined && (
            <Text dimColor wrap="truncate-end">
              {totals}
            </Text>
          )}
          </Box>
        {rows.length === 0 && <Text dimColor>Aucun sous-agent pour l'instant.</Text>}
        {running.length > 0 && section('EN COURS', running.length, 'cyan')}
        {shownCards.map(card)}
        {shownCards.length < running.length && (
          <Text dimColor>… {running.length - shownCards.length} autre(s) en cours</Text>
        )}
        {hasShells && commandsHead()}
        {hasShells && !isOpen && commandsLine()}
        {shownShells.flatMap(shellLines)}
        {ended.length > 0 && section('TERMINÉS', ended.length, 'green')}
        {shownEnded.map(endedLine)}
        {shownEnded.length < ended.length && <Text dimColor>… {ended.length - shownEnded.length} de plus</Text>}
      </Box>
    )
  })

  // The band above the prompt: the running agents' colours, the stage and the
  // run's progress. ✕ hides it until the next stage.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, stage)
    if (e.props.hasSurvey || current === null || (await read($, bandHidden))) return next(e)
    // Other plugins' bands draw above this one; the engine's own is not nested.
    const drawn = await next(e)
    const others = drawn.type === 'engine' ? undefined : drawn
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const isTerminal = e.surface === 'terminal'
    await read($, tick)
    const at = await read($, frame)
    const now = await $.clock.now()
    const rows = Object.values(await read($, agents))
    const running = rows.filter(row => row.endedAt === undefined).sort((a, b) => a.startedAt - b.startedAt)
    const endedCount = rows.length - running.length
    const width = Math.max(30, e.props.bodyColumns)

    // One small avatar per running agent on the desktop, a coloured dot each on
    // the terminal; past 8, a count.
    const shown = running.slice(0, 8)
    const crew =
      !isTerminal && 'Svg' in table
        ? shown.map(row => {
            const { Svg } = table
            return <Svg source={avatarSvg(at, bodyColor(row.hue ?? 0, false))} alt={nameOf(row.label) || 'agent'} width={24} height={18} />
          })
        : shown.map(row => <Text color={hueColor(row.hue ?? 0)}>●</Text>)
    const more = running.length > shown.length ? `+${running.length - shown.length}` : ''
    const crewWidth = isTerminal ? shown.length + more.length + (shown.length > 0 ? 1 : 0) : 0
    const head = `ORCHESTRA ▶ ${clean(current.text)}`
    const age = ` ${durationText(now - current.at)}`
    const counts = [
      running.length > 0 ? `${running.length} actif${running.length > 1 ? 's' : ''}` : undefined,
      endedCount > 0 ? `${endedCount} fini${endedCount > 1 ? 's' : ''}` : undefined,
    ]
      .filter(part => part !== undefined)
      .join(' · ')

    return (
      <Box flexDirection="column">
        {others}
        <Box flexDirection="row">
          {shown.length > 0 && (
            <Box flexDirection="row" flexShrink={0} marginRight={1}>
              {crew}
              {more !== '' && <Text dimColor>{more}</Text>}
            </Box>
          )}
          <Box flexShrink={1}>
            <Text bold color="claude" wrap="truncate-end">
              {cut(head, Math.max(8, width - crewWidth - age.length - 4))}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text dimColor>{age} </Text>
            <Button key="band-close" label="✕" plain dimColor onPress={() => update($, bandHidden, () => true)} />
          </Box>
        </Box>
        {(current.total !== undefined || counts !== '') && (
          <Box flexDirection="row">
            {current.total !== undefined &&
              progressRow(table, isTerminal, current.done ?? 0, current.total, Math.min(60, width - counts.length - 4))}
            {counts !== '' && (
              <Text dimColor>
                {current.total === undefined ? '' : ' · '}
                {counts}
              </Text>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
