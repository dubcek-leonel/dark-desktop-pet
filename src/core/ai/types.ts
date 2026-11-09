export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface AIProvider {
  /** Envía la conversación; llama a onToken con cada trozo y devuelve el texto completo. */
  chat(messages: ChatMessage[], onToken: (token: string) => void, signal?: AbortSignal): Promise<string>
  listModels(): Promise<string[]>
}
