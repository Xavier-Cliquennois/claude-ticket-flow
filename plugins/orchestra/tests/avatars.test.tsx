import { expect, mock, test } from 'claude-code/testing'

const pane = (columns: number) =>
  ({
    plugin: 'orchestra',
    component: 'Pane',
    requestId: 'orchestra',
    props: { bodyColumns: columns, scroll: { offset: 0, bodyRows: 38 } },
    viewport: { columns: columns + 4, rows: 40 },
  }) as const

// The engine's own band, drawn beneath the plugins.
const engineBand = (on: any) => on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)

const band = {
  plugin: 'orchestra',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 96, scroll: { offset: 0, bodyRows: 9 } },
  viewport: { columns: 100, rows: 40 },
} as const

type Info = { id: string; name: string; description: string; type: string; status: string }

// One running subagent that read a file, searched, then called a connector,
// over a request of opus 5.5 at high effort.
async function startAgent($: any, on: any) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  let list: Info[] = []
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  mock.env(on, {})
  on('agent.list', () => ({ value: list }) as never)
  on('session.usage', () => ({ value: { context: { window: 200000 } } }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500, model: 'm' },
    }
  })

  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/repo/docs/plan.md', agentId: 'a1' })
  await $.tool.call({ tool: 'Grep', pattern: 'TODO', agentId: 'a1' })
  await $.tool.call({ tool: 'mcp__github__create_pull_request', title: 'x', agentId: 'a1' })
  const step = async (index: number) => {
    const stream = $.turn.step({ turnId: 't', index, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })
    for await (const _chunk of stream) {
      // drain
    }
    await stream.result
  }
  // The model comes before the tick lists the agent; its context fill after.
  await step(0)
  list = [{ id: 'a1', name: 't29', description: 'Export CSV', type: 'general-purpose', status: 'running' }]
  await clock.advance(5000)
  await step(1)
  return { clock, end: () => (list = [{ ...list[0]!, status: 'completed' }]) }
}

test('a running agent shows its avatar as cells, its model and its latest steps, newest first (terminal)', async ($, on) => {
  await startAgent($, on)
  const ui = await $.ui.mount({ ...pane(96), surface: 'terminal' })
  const avatar = await ui.find({ type: 'Raster', key: 'avatar-a1' })
  expect(avatar?.props.columns).toBe(8)
  expect(avatar?.props.rows).toBe(3)
  expect(await ui.find({ type: 'Text', text: /opus 5\.5 · high/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◆ mcp/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^github · create pull request$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /‹ recherche TODO ‹ lecture plan\.md/ })).toBeDefined()
  await ui.unmount()
})

test('the avatar steps to its next frame while the agent runs, and stands still once it ended', async ($, on) => {
  const { clock, end } = await startAgent($, on)
  const ui = await $.ui.mount({ ...pane(96), surface: 'terminal' })
  const first = (await ui.find({ type: 'Raster', key: 'avatar-a1' }))?.props.cells
  await clock.advance(700)
  const second = (await ui.find({ type: 'Raster', key: 'avatar-a1' }))?.props.cells
  expect(second === first).toBe(false)
  end()
  await clock.advance(5000)
  // Ended, it leaves the cards for the TERMINÉS lines.
  expect(await ui.find({ type: 'Raster', key: 'avatar-a1' })).toBeUndefined()
  await ui.unmount()
})

test("the avatar's cells are a little Claude drawn in half blocks", async ($, on) => {
  await startAgent($, on)
  const ui = await $.ui.mount({ ...pane(96), surface: 'terminal' })
  const cells = String((await ui.find({ type: 'Raster', key: 'avatar-a1' }))?.props.cells)
  const bytes = Uint8Array.from(atob(cells), ch => ch.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  expect(words.length).toBe(8 * 3 * 3)
  // The first cell row: an empty corner, then the top of the body ('▄').
  const glyphs = Array.from({ length: 8 }, (_, i) => String.fromCodePoint(words[i * 3]!))
  expect(glyphs.join('')).toBe(' ▄▄▄▄▄▄ ')
  // The body is the first colour of the palette, Claude's orange.
  expect(words[1 * 3 + 1]).toBe(0xd97757)
  await ui.unmount()
})

test('on the desktop the avatar and the context gauge are SVG', async ($, on) => {
  await startAgent($, on)
  const ui = await $.ui.mount({ ...pane(96), surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.some(found => found.props.alt === 'avatar de t29')).toBe(true)
  expect(svgs.some(found => String(found.props.alt).startsWith('contexte'))).toBe(true)
  expect(svgs.every(found => !String(found.props.source).includes('<script'))).toBe(true)
  await ui.unmount()
})

test('the band shows the stage and the run progress, and ✕ hides it until the next stage', async ($, on) => {
  engineBand(on)
  await startAgent($, on)
  await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'vague 1/2 · t29 en cours', done: 3, total: 12 })
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ORCHESTRA ▶ vague 1\/2 · t29 en cours/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3\/12 tickets/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 actif/ })).toBeDefined()
  await ui.press({ key: 'band-close' })
  expect(await ui.find({ type: 'Text', text: /ORCHESTRA/ })).toBeUndefined()
  await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'vague 2/2' })
  expect(await ui.find({ type: 'Text', text: /ORCHESTRA ▶ vague 2\/2/ })).toBeDefined()
  // A stage without done and total draws no bar.
  expect(await ui.find({ type: 'Text', text: /tickets/ })).toBeUndefined()
  await ui.unmount()
})

test('the band draws nothing before a stage, and yields to a survey', async ($, on) => {
  engineBand(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ORCHESTRA/ })).toBeUndefined()
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'vague 1/2' })
  const survey = await $.ui.mount({ ...band, props: { ...band.props, hasSurvey: true }, surface: 'terminal' })
  expect(await survey.find({ type: 'Text', text: /ORCHESTRA/ })).toBeUndefined()
  await survey.unmount()
})

test('a progress that is not a count is ignored, and done never passes total', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'a', done: -1, total: 4 })
  const ui = await $.ui.mount({ ...pane(96), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /tickets/ })).toBeUndefined()
  await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'b', done: 9, total: 4 })
  expect(await ui.find({ type: 'Text', text: / 4\/4 tickets/ })).toBeDefined()
  await ui.unmount()
})

test('the band shows on the desktop with SVG avatars and bar', async ($, on) => {
  engineBand(on)
  await startAgent($, on)
  await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'vague 1/2', done: 1, total: 2 })
  const ui = await $.ui.mount({ ...band, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.some(found => found.props.alt === 't29')).toBe(true)
  expect(svgs.some(found => found.props.alt === '1 sur 2 tickets')).toBe(true)
  await ui.unmount()
})
