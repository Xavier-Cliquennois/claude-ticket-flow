// The run's progress, when the orchestrator gives it: tickets merged out of
// the tickets planned. Optional: a stage kept from an earlier version has none.
export type Stage = { text: string; at: number; done?: number; total?: number }

// What a tool call did, sorted for its colour in the pane.
export type StepKind = 'commande' | 'lecture' | 'écriture' | 'recherche' | 'web' | 'mcp' | 'agent' | 'outil'

export type Step = { kind: StepKind; text: string; at: number }

export type AgentRow = {
  id: string
  label: string
  type: string
  status: string
  startedAt: number
  endedAt?: number
  lastTool?: string
  contextTokens?: number
  compactions: number
  // Tool calls the agent made and tokens its requests counted (input, cache
  // reads and writes, output), summed from the mod's own events. Optional:
  // a row kept from an earlier version reads as 0.
  toolCalls?: number
  tokens?: number
  // Its latest tool calls, newest last, and the model and effort of its latest
  // request. Optional for the same reason.
  steps?: Step[]
  model?: string
  effort?: string
  // Its avatar's colour, an index in the mod's palette, handed out in turn.
  hue?: number
}

export type ShellRow = {
  id: string
  // The loop that ran it: a subagent's id, absent for the main session.
  agentId?: string
  description: string
  command: string
  isBackground: boolean
  startedAt: number
  endedAt?: number
  status: 'running' | 'completed' | 'failed' | 'killed'
  taskId?: string
  outputPath?: string
  // The background command dies with its caller's final response.
  endsWithOwner?: boolean
  tail: string[]
}

declare module 'claude-code' {
  interface PluginState {
    orchestra: {
      stage: Stage | null
      agents: Record<string, AgentRow>
      shells: Record<string, ShellRow>
      tick: number
      // Whether the COMMANDES block is unfolded.
      commandsOpen: boolean
      // The avatars' animation frame, moved while an agent runs.
      frame: number
      // The band above the prompt was closed: it comes back with the next stage.
      bandHidden: boolean
    }
  }
}
