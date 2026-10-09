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

declare module 'claude-code' {
  interface PluginState {
    orchestra: {
      stage: Stage | null
      agents: Record<string, AgentRow>
      tick: number
    }
  }
}
