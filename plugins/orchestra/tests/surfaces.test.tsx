import { expect, mock, test } from 'claude-code/testing'

const PANE = { plugin: 'orchestra', component: 'Pane', requestId: 'orchestra', props: { bodyColumns: 96, scroll: { offset: 0, bodyRows: 38 } }, viewport: { columns: 100, rows: 40 } } as const

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
  test(`the pane draws on the ${surface} surface`, async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0) })
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
    await $.tool.call({ tool: 'mcp__orchestra__stage', text: 'vague 1/2' })
    await $.tool.call({ tool: 'Bash', command: 'git push', description: 'Push branch' })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /ORCHESTRA/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Push branch/ })).toBeDefined()
    await ui.unmount()
  })
}
