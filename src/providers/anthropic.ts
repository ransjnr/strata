/**
 * Anthropic provider adapter for Strata agents.
 *
 * Uses the official `@anthropic-ai/sdk`. The SDK is a peer dependency — you
 * must install it yourself:
 *
 *   npm install @anthropic-ai/sdk
 *
 * Tool input schemas are converted to JSON Schema via `zod-to-json-schema` if
 * available; otherwise we fall back to a minimal best-effort conversion that
 * works for plain object schemas.
 */

import type {
  AgentMessage,
  AgentProvider,
  ProviderInvokeArgs,
  ProviderInvokeResult,
  ToolCall,
} from '../provider.js'
import type { AnyToolDef } from '../tool.js'
import type { AnyZodObject } from '../types.js'

// ─── Minimal client surface (avoids hard dependency on the SDK at type level) ─

interface AnthropicMessageCreateParams {
  model: string
  max_tokens: number
  system?: string
  messages: unknown[]
  tools?: unknown[]
  temperature?: number
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string }
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

interface AnthropicMessageResponse {
  content: AnthropicContentBlock[]
  stop_reason: string | null
}

interface AnthropicClientLike {
  messages: {
    create(
      params: AnthropicMessageCreateParams,
      options?: { signal?: AbortSignal },
    ): Promise<AnthropicMessageResponse>
  }
}

// ─── JSON Schema conversion ─────────────────────────────────────────────────

/**
 * Best-effort Zod → JSON Schema for tool inputs. Covers strings, numbers,
 * booleans, arrays, enums, optionals, and nested objects — enough for typical
 * tool schemas. For richer support, install `zod-to-json-schema` and Strata
 * will use it automatically.
 */
function zodToJsonSchema(schema: AnyZodObject): Record<string, unknown> {
  // Try to use zod-to-json-schema if it's installed.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('zod-to-json-schema') as {
      zodToJsonSchema: (s: unknown) => Record<string, unknown>
    }
    return mod.zodToJsonSchema(schema)
  } catch {
    return fallbackZodToJsonSchema(schema)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fallbackZodToJsonSchema(schema: any): Record<string, unknown> {
  const def = schema?._def
  if (!def) return { type: 'object' }
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [k, v] of Object.entries(shape ?? {})) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const child: any = v
        properties[k] = fallbackZodToJsonSchema(child)
        if (child?._def?.typeName !== 'ZodOptional') required.push(k)
      }
      return {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      }
    }
    case 'ZodString':
      return { type: 'string' }
    case 'ZodNumber':
      return { type: 'number' }
    case 'ZodBoolean':
      return { type: 'boolean' }
    case 'ZodLiteral':
      return { const: def.value }
    case 'ZodEnum':
      return { type: 'string', enum: def.values }
    case 'ZodArray':
      return { type: 'array', items: fallbackZodToJsonSchema(def.type) }
    case 'ZodOptional':
    case 'ZodNullable':
      return fallbackZodToJsonSchema(def.innerType)
    case 'ZodUnion':
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        anyOf: def.options.map((o: any) => fallbackZodToJsonSchema(o)),
      }
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: fallbackZodToJsonSchema(def.valueType),
      }
    default:
      return {}
  }
}

// ─── Message conversion ─────────────────────────────────────────────────────

function toAnthropicMessages(messages: AgentMessage[]): unknown[] {
  // Anthropic groups consecutive tool_results into a single user message.
  const out: unknown[] = []
  let pendingToolResults: unknown[] = []

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      out.push({ role: 'user', content: pendingToolResults })
      pendingToolResults = []
    }
  }

  for (const m of messages) {
    if (m.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      })
      continue
    }
    flushToolResults()
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else {
      // assistant
      const blocks: unknown[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })
      }
      out.push({
        role: 'assistant',
        content: blocks.length ? blocks : [{ type: 'text', text: '' }],
      })
    }
  }
  flushToolResults()
  return out
}

function toAnthropicTools(tools: readonly AnyToolDef[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.input),
  }))
}

function fromAnthropicResponse(
  res: AnthropicMessageResponse,
): ProviderInvokeResult {
  let text = ''
  const toolCalls: ToolCall[] = []
  for (const block of res.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    } else if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      })
    }
  }

  const stopReason: ProviderInvokeResult['stopReason'] =
    res.stop_reason === 'tool_use'
      ? 'tool_use'
      : res.stop_reason === 'end_turn'
        ? 'end_turn'
        : res.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : res.stop_reason === 'stop_sequence'
            ? 'stop_sequence'
            : 'other'

  return {
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length ? { toolCalls } : {}),
    },
    stopReason,
  }
}

// ─── Provider factory ───────────────────────────────────────────────────────

export interface AnthropicProviderOptions {
  /** An instance of `new Anthropic()` from `@anthropic-ai/sdk`. */
  client: AnthropicClientLike
  /** Default max_tokens when an agent doesn't specify one. */
  defaultMaxTokens?: number
}

/**
 * Create an Anthropic-backed agent provider.
 *
 * @example
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk'
 * import { setDefaultProvider, anthropicProvider } from '@ransjnr/strata'
 *
 * setDefaultProvider(anthropicProvider({ client: new Anthropic() }))
 * ```
 */
export function anthropicProvider(
  opts: AnthropicProviderOptions,
): AgentProvider {
  const defaultMaxTokens = opts.defaultMaxTokens ?? 4096

  return {
    name: 'anthropic',
    async invoke(args: ProviderInvokeArgs): Promise<ProviderInvokeResult> {
      const params: AnthropicMessageCreateParams = {
        model: args.model,
        max_tokens: args.maxTokens ?? defaultMaxTokens,
        messages: toAnthropicMessages(args.messages),
        ...(args.system ? { system: args.system } : {}),
        ...(args.tools && args.tools.length
          ? { tools: toAnthropicTools(args.tools) }
          : {}),
        ...(typeof args.temperature === 'number'
          ? { temperature: args.temperature }
          : {}),
      }

      const res = await opts.client.messages.create(
        params,
        args.signal ? { signal: args.signal } : undefined,
      )
      return fromAnthropicResponse(res)
    },
  }
}
