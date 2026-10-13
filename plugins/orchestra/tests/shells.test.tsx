import { expect, mock, test } from 'claude-code/testing'

const PANE = { plugin: 'orchestra', component: 'Pane', requestId: 'orchestra', props: {}, viewport: { columns: 100, rows: 40 } } as const

test('folded, the block shows the last command on one line, how long ago it ended', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Show status' })
  await $.tool.call({ tool: 'Bash', command: 'uv run pytest -q', description: 'Run tests' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▸ COMMANDES/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ orchestrateur · Run tests · fini il y a/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$ uv run pytest -q/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Show status/ })).toBeUndefined()
  await ui.unmount()
})

test('a press unfolds the latest three commands with their command lines', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  for (const name of ['one', 'two', 'three', 'four']) {
    await $.tool.call({ tool: 'Bash', command: `echo ${name}`, description: `Step ${name}` })
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'commands' })
  expect(await ui.find({ type: 'Text', text: /▾ COMMANDES/ })).toBeDefined()
  for (const name of ['two', 'three', 'four']) {
    expect(await ui.find({ type: 'Text', text: new RegExp(`\\$ echo ${name}`) })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /Step one/ })).toBeUndefined()
  await ui.press({ key: 'commands' })
  expect(await ui.find({ type: 'Text', text: /\$ echo four/ })).toBeUndefined()
  await ui.unmount()
})

test('a failed command is marked failed', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true as const }))
  await $.tool.call({ tool: 'Bash', command: 'false', description: 'Fail' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✗ orchestrateur · Fail/ })).toBeDefined()
  await ui.press({ key: 'commands' })
  expect(await ui.find({ type: 'Text', text: /✗ orchestrateur · Fail .* failed/ })).toBeDefined()
  await ui.unmount()
})

test('a background command shows how long it runs, its tail when unfolded, until its notification ends it', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  const outputPath = '/tmp/tasks/b1.output'
  const output = 'step 1/2\nstep 2/2\r\u001b[32mall done\u001b[0m\n'
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: output.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: output }))
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
    text: `Command running in background with ID: b1. Output is being written to: ${outputPath}. You will be notified when it completes.`,
  }))
  await $.tool.call({ tool: 'Bash', command: 'bash verif.sh', description: 'Run verification', run_in_background: true })

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▸ COMMANDES · 1 en cours/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⏵ orchestrateur · Run verification · depuis/ })).toBeDefined()
  await ui.unmount()

  await $.session.append({
    message: {
      type: 'user',
      content: [
        {
          type: 'text',
          text: `<task-notification>\n<task-id>b1</task-id>\n<output-file>${outputPath}</output-file>\n<status>completed</status>\n</task-notification>`,
        },
      ],
    },
  })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✓ orchestrateur · Run verification · fini il y a/ })).toBeDefined()
  await ui.press({ key: 'commands' })
  // The tail keeps what the carriage return left, escape sequences dropped.
  const last = await ui.find({ type: 'Text', text: /│ all done/ })
  expect(last).toBeDefined()
  expect(last?.text.includes('\u001b')).toBe(false)
  await ui.unmount()
})
