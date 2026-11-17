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

declare module 'claude-code' {
  interface PluginState {
    'needs-your-word': { board: Board }
  }
}
