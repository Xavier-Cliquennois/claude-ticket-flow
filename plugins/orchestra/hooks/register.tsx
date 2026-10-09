import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, ShellRow, Stage } from '../types'

const PANE = 'orchestra'
const TICK_MS = 5000
const DONE = new Set(['completed', 'failed', 'killed', 'idle'])

const stage = atom({ plugin: 'orchestra', key: 'stage' } as const, null)
const agents = atom({ plugin: 'orchestra', key: 'agents' } as const, {})
const shells = atom({ plugin: 'orchestra', key: 'shells' } as const, {})
const tick = atom({ plugin: 'orchestra', key: 'tick' } as const, 0)

// Commands kept in the pane: every running one, plus the latest ended ones.
const KEPT_SHELLS = 12
const TAIL_LINES = 3
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
      if (current !== null) parts.push(`▶ ${current.text}`)
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
    const { Box, Text } = $.ui.resolve(e)
    await read($, tick)
    const now = await $.clock.now()
    const current = await read($, stage)
    const rows = Object.values(await read($, agents)).sort((a, b) => b.startedAt - a.startedAt)
    const running = rows.filter(row => row.endedAt === undefined)
    const ended = rows.filter(row => row.endedAt !== undefined)
    const width = Math.max(30, (e.viewport?.columns ?? 60) - 4)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    const shellRows = Object.values(await read($, shells)).sort((a, b) => b.startedAt - a.startedAt)
    const runningShells = shellRows.filter(row => row.endedAt === undefined)
    const endedShells = shellRows.filter(row => row.endedAt !== undefined)
    // Agents take half the room when commands are listed, all of it otherwise.
    const agentRoom = shellRows.length === 0 ? room : Math.max(2, Math.floor(room / 2))
    const shellRoom = room - Math.min(agentRoom, Math.max(1, rows.length * 2))
    const owner = (row: ShellRow): string => {
      if (row.agentId === undefined) return 'orchestrateur'
      const agent = rows.find(candidate => candidate.id === row.agentId)
      return agent === undefined ? 'sous-agent' : cut(agent.label.split(' · ')[0] ?? agent.label, 24)
    }

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

    // A running command shows its last lines, an ended one its very last.
    const shownTail = (row: ShellRow): string[] => (row.endedAt === undefined ? row.tail : row.tail.slice(-1))
    const shellHeight = (row: ShellRow): number => 2 + shownTail(row).length

    const shellLine = (row: ShellRow) => {
      const isDone = row.endedAt !== undefined
      const mark = row.status === 'failed' || row.status === 'killed' ? '✗' : isDone ? '✓' : '●'
      const header = [
        owner(row),
        row.description === '' ? undefined : row.description,
        durationText((row.endedAt ?? now) - row.startedAt),
        row.isBackground ? 'fond' : undefined,
        isDone && row.status !== 'completed' ? row.status : undefined,
      ]
        .filter(part => part !== undefined)
        .join(' · ')
      return (
        <Box flexDirection="column">
          <Text dimColor={isDone} bold={!isDone}>
            {mark} {cut(header, width - 2)}
          </Text>
          <Text dimColor color={isDone ? undefined : 'cyan'}>
            {'  $ '}
            {cut(row.command, width - 4)}
          </Text>
          {shownTail(row).map(tailLine => (
            <Text dimColor>
              {'  │ '}
              {cut(tailLine, width - 4)}
            </Text>
          ))}
        </Box>
      )
    }

    const shownShells: ShellRow[] = []
    let used = 1
    for (const row of [...runningShells, ...endedShells]) {
      const height = shellHeight(row)
      if (used + height > shellRoom && shownShells.length > 0) break
      shownShells.push(row)
      used += height
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
        {[...running, ...ended].slice(0, Math.max(1, Math.floor(agentRoom / 2))).map(line)}
        {shellRows.length > 0 && <Text> </Text>}
        {shellRows.length > 0 && (
          <Text bold>
            Commandes · {runningShells.length} en cours
          </Text>
        )}
        {shownShells.map(shellLine)}
      </Box>
    )
  })
}
