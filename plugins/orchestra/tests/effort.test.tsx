import { expect, mock, test } from 'claude-code/testing'

const pane = (columns: number) =>
  ({
    plugin: 'orchestra',
    component: 'Pane',
    requestId: 'orchestra',
    props: { bodyColumns: columns, scroll: { offset: 0, bodyRows: 38 } },
    viewport: { columns: columns + 4, rows: 40 },
  }) as const

type Info = { id: string; name: string; description: string; type: string; status: string }

// A subagent that calls two tools and makes two requests, one of each before
// the first tick lists it, then ends.
async function runOneAgent($: any, on: any): Promise<void> {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  let list: Info[] = []
  // What session.start's hook calls, answered as a session would.
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
  const step = async (index: number) => {
    const stream = $.turn.step({ turnId: 't', index, model: 'm', messageCount: 1, agentId: 'a1' })
    for await (const _chunk of stream) {
      // drain
    }
    await stream.result
  }

  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/x', agentId: 'a1' })
  await step(0)
  list = [{ id: 'a1', name: 't29', description: 'Effort counts', type: 'general-purpose', status: 'running' }]
  await clock.advance(5000)
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' })
  await step(1)
  list = [{ ...list[0]!, status: 'completed' }]
  await clock.advance(5000)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a finished agent shows its duration, tool calls and tokens on one line (${surface})`, async ($, on) => {
    await runOneAgent($, on)
    const ui = await $.ui.mount({ ...pane(96), surface })
    // Two requests of 10 000 tokens each, counted before and after the first tick.
    expect(await ui.find({ type: 'Text', text: /5 s · {3}2 appels · {3}20 k tok/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Σ 1 agent · 2 appels · 20 k tok$/ })).toBeDefined()
    await ui.unmount()
  })
}

test('on a narrow pane the effort takes its short form and the line still fits', async ($, on) => {
  await runOneAgent($, on)
  const ui = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  const meta = await ui.find({ type: 'Text', text: /app ·/ })
  expect(meta?.text).toBe('    5 s ·   2 app ·   20 k')
  expect(await ui.find({ type: 'Text', text: /s · +2 appels/ })).toBeUndefined()
  for (const found of await ui.findAll({ type: 'Text' })) expect(found.text.length <= 40).toBe(true)
  await ui.unmount()
})
