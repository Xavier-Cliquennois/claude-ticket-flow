import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Stage } from '../types'

const PANE = 'orchestra'
const TICK_MS = 5000
const DONE = new Set(['completed', 'failed', 'killed', 'idle'])

const stage = atom({ plugin: 'orchestra', key: 'stage' } as const, null)
const agents = atom({ plugin: 'orchestra', key: 'agents' } as const, {})
const tick = atom({ plugin: 'orchestra', key: 'tick' } as const, 0)

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
        "Publish the orchestrator's current stage in the Orchestra pane and status line, one short line (e.g. 'vague 2/3 · t265 relu · t266 en cours'). Call it at every state change of an epic run.",
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The stage, one line' } },
        required: ['text'],
      },
      isDeferred: false,
    })

    $.clock.every(TICK_MS, async () => {
      const now = await $.clock.now()
      const usage = await $.session.usage()
      windowTokens = usage.context.window
      const list = await $.agent.list()
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
          }
          const isDone = DONE.has(info.status)
          merged[info.id] = {
            ...row,
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
      if (list.length > 0) await openPane($)

      // The status line (ccstatusline) shows this file: the engine's own pinned
      // status is plain text behind a warning glyph, so it is not used.
      const current = await read($, stage)
      const runningCount = list.filter(info => !DONE.has(info.status)).length
      const parts: string[] = []
      if (current !== null) parts.push(`▶ ${current.text}`)
      if (runningCount > 0) parts.push(`${runningCount} agent${runningCount > 1 ? 's' : ''} actif${runningCount > 1 ? 's' : ''}`)
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
    const value: Stage = { text: cut(clean(text).trim(), 160), at: await $.clock.now() }
    await update($, stage, () => value)
    await openPane($)
    return { result: 'Étape affichée.' }
  })

  // Remember each subagent's last tool.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      await update($, agents, rows => {
        const row = rows[id]
        return row === undefined ? rows : { ...rows, [id]: { ...row, lastTool: e.tool } }
      })
    }
    return next(e)
  })

  // A subagent's context fill: the input tokens its latest request was answered over.
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    await read($, tick)
    const now = await $.clock.now()
    const current = await read($, stage)
    const rows = Object.values(await read($, agents)).sort((a, b) => b.startedAt - a.startedAt)
    const running = rows.filter(row => row.endedAt === undefined)
    const ended = rows.filter(row => row.endedAt !== undefined)
    const width = Math.max(30, (e.viewport?.columns ?? 60) - 4)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)

    const line = (row: AgentRow) => {
      const elapsed = durationText((row.endedAt ?? now) - row.startedAt)
      const pct =
        row.contextTokens === undefined ? undefined : Math.round((100 * row.contextTokens) / windowTokens)
      const ctxColor = pct === undefined ? undefined : pct >= 40 ? 'red' : pct >= 30 ? 'yellow' : 'green'
      const isDone = row.endedAt !== undefined
      const mark = row.status === 'failed' || row.status === 'killed' ? '✗' : isDone ? '✓' : '●'
      const detail = [
        elapsed,
        pct === undefined ? undefined : `ctx ${pct} %`,
        row.compactions > 0 ? `${row.compactions} compact.` : undefined,
        isDone ? row.status : row.lastTool,
      ]
        .filter(part => part !== undefined)
        .join(' · ')
      return (
        <Box flexDirection="column">
          <Text dimColor={isDone} bold={!isDone}>
            {mark} {cut(row.label, width - 2)}
          </Text>
          <Text dimColor={isDone} color={isDone ? undefined : ctxColor}>
            {'  '}
            {cut(detail, width - 2)}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>
          {clockText(now)} · {running.length} agent{running.length > 1 ? 's' : ''} actif
          {running.length > 1 ? 's' : ''}
        </Text>
        <Text dimColor={current === null}>
          {current === null
            ? 'Étape : (aucune publiée)'
            : `Étape : ${cut(current.text, width - 8)} (${durationText(now - current.at)})`}
        </Text>
        <Text> </Text>
        {rows.length === 0 && <Text dimColor>Aucun sous-agent pour l'instant.</Text>}
        {[...running, ...ended].slice(0, Math.max(1, Math.floor(room / 2))).map(line)}
      </Box>
    )
  })
}
