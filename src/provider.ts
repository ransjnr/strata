import type { z } from 'zod'
import type { AnyToolDef } from './tool.js'
import type { AnyZodObject } from './types.js'

/**
 * A provider-agnostic message format. Agents speak this internally; provider
 * adapters translate it to/from the underlying SDK shape.
 */
export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface ProviderInvokeArgs {
  model: string
  system?: string
  messages: AgentMessage[]
  tools?: AnyToolDef[]
  /** When set, the provider should request structured output matching this schema. */
  outputSchema?: AnyZodObject
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface ProviderInvokeResult {
  /** The assistant message produced this turn. */
  message: Extract<AgentMessage, { role: 'assistant' }>
  /** When the provider returns structured output (no further tool calls), the parsed value goes here. */
  output?: unknown
  /** Why generation stopped — used by the runtime to decide whether to loop. */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'other'
}

/**
 * Minimal LLM provider interface. Implementations live in `src/providers/`.
 */
export interface AgentProvider {
  readonly name: string
  invoke(args: ProviderInvokeArgs): Promise<ProviderInvokeResult>
}

// ─── Default provider registry ───────────────────────────────────────────────

let defaultProvider: AgentProvider | null = null

/**
 * Register a default provider so `agent()` can be defined without an explicit
 * `provider:` field. Typically called once at app startup.
 *
 * @example
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk'
 * import { setDefaultProvider, anthropicProvider } from '@ransjnr/strata'
 *
 * setDefaultProvider(anthropicProvider({ client: new Anthropic() }))
 * ```
 */
export function setDefaultProvider(provider: AgentProvider): void {
  defaultProvider = provider
}

export function getDefaultProvider(): AgentProvider | null {
  return defaultProvider
}

// ─── Output-schema helpers ───────────────────────────────────────────────────

/**
 * Convert a Zod object schema into a tool input schema description that
 * providers can use to enforce structured output via tool-use.
 */
export function zodToOutputDescription(schema: AnyZodObject): {
  name: string
  description: string
  input: AnyZodObject
} {
  return {
    name: 'submit_output',
    description:
      'Submit the final structured output. Call this exactly once when you have completed the task.',
    input: schema,
  }
}

export type InferProvides<S extends AnyZodObject> = z.infer<S>
