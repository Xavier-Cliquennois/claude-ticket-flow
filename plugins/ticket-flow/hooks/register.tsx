import type { Register } from 'claude-code'

import { registerUpdateBand } from './update-band'

export const register: Register = on => {
  registerUpdateBand(on, {
    marketplace: 'claude-ticket-flow',
    repo: 'Xavier-Cliquennois/claude-ticket-flow',
    manifestPath: 'plugins/ticket-flow/.claude-plugin/plugin.json',
    // Bump `current` (and the marker setup-project writes) when the Workflow
    // section's template changes in a way existing projects should pick up.
    workflow: { marker: 'ticket-flow workflow', current: 3, command: 'ticket-flow:setup-project' },
  })
}
