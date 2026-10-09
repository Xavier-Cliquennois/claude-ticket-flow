import { expect, mock, test } from 'claude-code/testing'

const PANE = { plugin: 'orchestra', component: 'Pane', requestId: 'orchestra', props: {}, viewport: { columns: 80, rows: 30 } } as const

test('the stage tool shows its text in the pane', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  const ran = await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'vague 2/3 · t265 relu' })
  expect(ran.deny).toBeUndefined()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /vague 2\/3 · t265 relu/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Aucun sous-agent/ })).toBeDefined()
  await ui.unmount()
})

test('the stage tool strips control characters', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'a\u001b]0;pwned\u0007b\u009bc' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = await ui.find({ type: 'Text', text: /Étape :/ })
  expect(shown?.text.includes('\u001b')).toBe(false)
  expect(shown?.text.includes('\u009b')).toBe(false)
  await ui.unmount()
})
