import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = {
  plugin: 'ticket-flow',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 },
  viewport: { columns: 120, rows: 30 },
} as const

/** The engine beneath the plugin: a published version and a project CLAUDE.md. */
function engine(on: On, published: string, claudeMd?: string) {
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: `{"version":"${published}"}` } }))
  on('fs.read', ($, e) => {
    if (e.path.endsWith('CLAUDE.md')) {
      if (claudeMd === undefined) return { deny: 'ENOENT' }
      return { value: claudeMd }
    }
    return { value: '{"name":"ticket-flow","version":"0.4.0"}' }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

for (const surface of SURFACES) {
  test(`${surface}: a newer published version shows the update band`, async ($, on) => {
    engine(on, '0.5.0')
    const ui = await $.ui.mount({ ...BAND, surface })
    const again = await $.ui.mount({ ...BAND, surface })
    expect(await again.find({ type: 'Text', text: /0\.5\.0 disponible/ })).toBeDefined()
    expect(await again.find({ type: 'Button', label: 'Mettre à jour' })).toBeDefined()
    await ui.unmount()
    await again.unmount()
  })

  test(`${surface}: the installed version is the latest, no band`, async ($, on) => {
    engine(on, '0.4.0')
    await (await $.ui.mount({ ...BAND, surface })).unmount()
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /disponible/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a Workflow section without the marker offers setup-project`, async ($, on) => {
    engine(on, '0.4.0', '# P\n\n## Workflow\n\n### Tickets\n')
    await (await $.ui.mount({ ...BAND, surface })).unmount()
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Button', label: 'Remettre à niveau' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: a Workflow section with the current marker says nothing`, async ($, on) => {
    engine(on, '0.4.0', '# P\n\n## Workflow\n<!-- ticket-flow workflow: 3 -->\n')
    await (await $.ui.mount({ ...BAND, surface })).unmount()
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Button', label: 'Remettre à niveau' })).toBeUndefined()
    await ui.unmount()
  })
}
