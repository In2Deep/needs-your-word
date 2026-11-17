export type Question = {
  id: string
  ask: string
  why: string
  recommend: string
}

export type Board = {
  questions: Question[]
  // question id -> the answer drafted into the prompt box from here
  drafted: Record<string, string>
  problem: string | null
}

// What the assistant passes to the mod's tool.
export type QuestionCall = {
  action: 'ask' | 'resolve' | 'list'
  id?: string
  ask?: string
  why?: string
  recommend?: string
}

declare module 'claude-code' {
  interface PluginState {
    'needs-your-word': { board: Board }
  }
  interface McpToolInputs {
    'mcp__needs-your-word__question': QuestionCall
  }
}
