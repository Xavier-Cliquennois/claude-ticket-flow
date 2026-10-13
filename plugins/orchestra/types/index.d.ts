export type Stage = { text: string; at: number }

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
    }
  }
}
