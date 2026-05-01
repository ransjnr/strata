/**
 * Groq provider adapter for Strata agents.
 *
 * Uses the official `groq-sdk`. Install it yourself:
 *
 *   npm install groq-sdk
 *
 * Groq exposes an OpenAI-compatible chat-completions API with native
 * tool-use, so this adapter translates Strata's provider-agnostic
 * `AgentMessage` / tool format into OpenAI-style messages and back.
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

interface GroqChatCompletionParams {
  model: string
  messages: unknown[]
  tools?: unknown[]
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
  max_tokens?: number
  temperature?: number
}

interface GroqToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface GroqChoice {
  message: {
    role: string
    content: string | null
    tool_calls?: GroqToolCall[]
  }
  finish_reason: string | null
}

interface GroqChatCompletionResponse {
  choices: GroqChoice[]
}

interface GroqClientLike {
  chat: {
    completions: {
      create(
        params: GroqChatCompletionParams,
        options?: { signal?: AbortSignal },
      ): Promise<GroqChatCompletionResponse>
    }
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

function toGroqMessages(
  messages: AgentMessage[],
  system: string | undefined,
): unknown[] {
  const out: unknown[] = []
  if (system) out.push({ role: 'system', content: system })

  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const msg: Record<string, unknown> = {
        role: 'assistant',
        content: m.content || '',
      }
      if (m.toolCalls && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.input === 'string'
                ? tc.input
                : JSON.stringify(tc.input ?? {}),
          },
        }))
      }
      out.push(msg)
    } else {
      // tool result
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      })
    }
  }
  return out
}

function toGroqTools(tools: readonly AnyToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.input),
    },
  }))
}

function fromGroqResponse(
  res: GroqChatCompletionResponse,
): ProviderInvokeResult {
  const choice = res.choices[0]
  if (!choice) {
    return {
      message: { role: 'assistant', content: '' },
      stopReason: 'other',
    }
  }

  const text = choice.message.content ?? ''
  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: parseJsonOrString(tc.function.arguments),
  }))

  const stopReason: ProviderInvokeResult['stopReason'] =
    choice.finish_reason === 'tool_calls'
      ? 'tool_use'
      : choice.finish_reason === 'stop'
        ? 'end_turn'
        : choice.finish_reason === 'length'
          ? 'max_tokens'
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

function parseJsonOrString(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

// ─── Provider factory ───────────────────────────────────────────────────────

export interface GroqProviderOptions {
  /** An instance of `new Groq()` from `groq-sdk`. */
  client: GroqClientLike
  /** Default max_tokens when an agent doesn't specify one. */
  defaultMaxTokens?: number
}

/**
 * Create a Groq-backed agent provider.
 *
 * @example
 * ```ts
 * import Groq from 'groq-sdk'
 * import { setDefaultProvider } from '@ransjnr/strata'
 * import { groqProvider } from '@ransjnr/strata/groq'
 *
 * setDefaultProvider(groqProvider({ client: new Groq() }))
 * ```
 */
export function groqProvider(opts: GroqProviderOptions): AgentProvider {
  const defaultMaxTokens = opts.defaultMaxTokens ?? 4096

  return {
    name: 'groq',
    async invoke(args: ProviderInvokeArgs): Promise<ProviderInvokeResult> {
      const params: GroqChatCompletionParams = {
        model: args.model,
        max_tokens: args.maxTokens ?? defaultMaxTokens,
        messages: toGroqMessages(args.messages, args.system),
        ...(args.tools && args.tools.length
          ? { tools: toGroqTools(args.tools) }
          : {}),
        ...(typeof args.temperature === 'number'
          ? { temperature: args.temperature }
          : {}),
      }

      const res = await opts.client.chat.completions.create(
        params,
        args.signal ? { signal: args.signal } : undefined,
      )
      return fromGroqResponse(res)
    },
  }
}
