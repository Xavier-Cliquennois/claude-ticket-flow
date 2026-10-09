import { expect, mock, test } from 'claude-code/testing'

const PANE = { plugin: 'orchestra', component: 'Pane', requestId: 'orchestra', props: {}, viewport: { columns: 100, rows: 40 } } as const

test('a foreground command shows who ran it, then its end', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'uv run pytest -q', description: 'Run tests' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Commandes · 0 en cours/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ orchestrateur · Run tests/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$ uv run pytest -q/ })).toBeDefined()
  await ui.unmount()
})

test('a failed command is marked failed', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true as const }))
  await $.tool.call({ tool: 'Bash', command: 'false', description: 'Fail' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✗ orchestrateur · Fail .* failed/ })).toBeDefined()
  await ui.unmount()
})

test('a background command shows its output tail until its notification ends it', async ($, on) => {
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
  expect(await ui.find({ type: 'Text', text: /● orchestrateur · Run verification .* fond/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Commandes · 1 en cours/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /✓ orchestrateur · Run verification/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Commandes · 0 en cours/ })).toBeDefined()
  // The tail keeps what the carriage return left, escape sequences dropped.
  const last = await ui.find({ type: 'Text', text: /│ all done/ })
  expect(last).toBeDefined()
  expect(last?.text.includes('\u001b')).toBe(false)
  await ui.unmount()
})
