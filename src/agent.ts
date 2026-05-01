import type { z } from 'zod'
import { StratumError } from './error.js'
import {
  getDefaultProvider,
  zodToOutputDescription,
  type AgentMessage,
  type AgentProvider,
} from './provider.js'
import { stratum } from './stratum.js'
import type { AnyToolDef } from './tool.js'
import type {
  AnyStratumDef,
  AnyZodObject,
  DepsContext,
  StratumDef,
} from './types.js'

// ─── Public types ────────────────────────────────────────────────────────────

export interface AgentResolveArgs<Deps extends readonly AnyStratumDef[]> {
  req: Request
  context: DepsContext<Deps>
}

export interface AgentConfig<
  Name extends string,
  Provides extends AnyZodObject,
  Deps extends readonly AnyStratumDef[],
> {
  name: Name
  provides: Provides
  requires?: Deps
  /** Model identifier for the provider, e.g. 'claude-sonnet-4-6'. */
  model: string
  /** Static system prompt, or a function of the resolved deps. */
  system?: string | ((args: AgentResolveArgs<Deps>) => string)
  /** First user message — function of the resolved deps. */
  prompt:
    | string
    | ((args: AgentResolveArgs<Deps>) => string | AgentMessage[])
  tools?: readonly AnyToolDef[]
  maxTurns?: number
  maxTokens?: number
  temperature?: number
  /** Override the default provider for this agent. */
  provider?: AgentProvider
  /** Forward an abort signal to the provider and tools. */
  signal?: AbortSignal
}

export interface AgentRunResult<Output> {
  output: Output
  messages: AgentMessage[]
  turns: number
}

// ─── agent() factory ─────────────────────────────────────────────────────────

/**
 * Define an LLM-powered stratum.
 *
 * An agent is a stratum whose `resolve` runs a tool-use loop with an LLM
 * provider and returns structured output validated against `provides`.
 *
 * @example
 * ```ts
 * const summarizer = agent({
 *   name: 'summary',
 *   provides: z.object({ summary: z.string(), tags: z.array(z.string()) }),
 *   requires: [bodyStratum],
 *   model: 'claude-sonnet-4-6',
 *   system: 'You are a concise summarizer.',
 *   prompt: ({ context }) => `Summarize:\n\n${context.body.data.text}`,
 *   tools: [searchTool],
 * })
 * ```
 */
export function agent<
  const Name extends string,
  const Provides extends AnyZodObject,
  const Deps extends readonly AnyStratumDef[] = readonly [],
>(
  config: AgentConfig<Name, Provides, Deps>,
): StratumDef<Name, Provides, Deps> {
  const requires = (config.requires ?? ([] as unknown as Deps)) as Deps

  return stratum({
    name: config.name,
    provides: config.provides,
    requires,
    resolve: async ({ req, context }) => {
      const provider = config.provider ?? getDefaultProvider()
      if (!provider) {
        throw new StratumError(
          500,
          `Agent "${config.name}" has no provider. Pass \`provider:\` or call setDefaultProvider() at startup.`,
        )
      }

      const resolveArgs = {
        req,
        context,
      } as AgentResolveArgs<Deps>

      const system =
        typeof config.system === 'function'
          ? config.system(resolveArgs)
          : config.system

      const initialPrompt =
        typeof config.prompt === 'function'
          ? config.prompt(resolveArgs)
          : config.prompt

      const messages: AgentMessage[] =
        typeof initialPrompt === 'string'
          ? [{ role: 'user', content: initialPrompt }]
          : [...initialPrompt]

      const result = await runAgentLoop({
        provider,
        model: config.model,
        messages,
        outputSchema: config.provides,
        maxTurns: config.maxTurns ?? 8,
        agentName: config.name,
        ...(system !== undefined ? { system } : {}),
        ...(config.tools ? { tools: config.tools } : {}),
        ...(config.maxTokens !== undefined
          ? { maxTokens: config.maxTokens }
          : {}),
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {}),
        ...(config.signal ? { signal: config.signal } : {}),
      })

      return result.output as z.infer<Provides>
    },
  }) as StratumDef<Name, Provides, Deps>
}

// ─── Tool-use loop ───────────────────────────────────────────────────────────

interface RunAgentLoopArgs {
  provider: AgentProvider
  model: string
  system?: string
  messages: AgentMessage[]
  tools?: readonly AnyToolDef[]
  outputSchema: AnyZodObject
  maxTurns: number
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  agentName: string
}

export async function runAgentLoop(
  args: RunAgentLoopArgs,
): Promise<AgentRunResult<unknown>> {
  const submitTool = zodToOutputDescription(args.outputSchema)
  const allTools: AnyToolDef[] = [
    ...(args.tools ?? []),
    {
      name: submitTool.name,
      description: submitTool.description,
      input: submitTool.input,
      run: async ({ input }) => input,
    },
  ]

  const messages: AgentMessage[] = [...args.messages]

  for (let turn = 1; turn <= args.maxTurns; turn++) {
    if (args.signal?.aborted) {
      throw new StratumError(499, `Agent "${args.agentName}" aborted`)
    }

    const result = await args.provider.invoke({
      model: args.model,
      messages,
      tools: allTools,
      outputSchema: args.outputSchema,
      ...(args.system !== undefined ? { system: args.system } : {}),
      ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
      ...(args.temperature !== undefined
        ? { temperature: args.temperature }
        : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    })

    messages.push(result.message)

    const toolCalls = result.message.toolCalls ?? []

    // Look for the structured-output submit call first.
    const submit = toolCalls.find((c) => c.name === submitTool.name)
    if (submit) {
      const parsed = args.outputSchema.safeParse(submit.input)
      if (!parsed.success) {
        // Feed validation error back so the model can correct itself.
        messages.push({
          role: 'tool',
          toolCallId: submit.id,
          name: submit.name,
          content: `Invalid output. Issues: ${JSON.stringify(parsed.error.issues)}`,
        })
        continue
      }
      return { output: parsed.data, messages, turns: turn }
    }

    if (toolCalls.length === 0) {
      // Model ended without producing structured output. Nudge once, then fail.
      if (result.stopReason === 'end_turn' && turn < args.maxTurns) {
        messages.push({
          role: 'user',
          content: `You must call the \`${submitTool.name}\` tool with the final structured result before ending.`,
        })
        continue
      }
      throw new StratumError(
        500,
        `Agent "${args.agentName}" ended without structured output (stopReason=${result.stopReason})`,
      )
    }

    // Execute non-submit tool calls in parallel.
    const toolResults = await Promise.all(
      toolCalls.map(async (call) => {
        const def = allTools.find((t) => t.name === call.name)
        if (!def) {
          return {
            role: 'tool' as const,
            toolCallId: call.id,
            name: call.name,
            content: `Unknown tool: ${call.name}`,
          }
        }
        const parsed = def.input.safeParse(call.input)
        if (!parsed.success) {
          return {
            role: 'tool' as const,
            toolCallId: call.id,
            name: call.name,
            content: `Invalid input: ${JSON.stringify(parsed.error.issues)}`,
          }
        }
        try {
          const out = await def.run({
            input: parsed.data,
            ...(args.signal ? { signal: args.signal } : {}),
          })
          return {
            role: 'tool' as const,
            toolCallId: call.id,
            name: call.name,
            content:
              typeof out === 'string' ? out : JSON.stringify(out ?? null),
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return {
            role: 'tool' as const,
            toolCallId: call.id,
            name: call.name,
            content: `Tool error: ${msg}`,
          }
        }
      }),
    )

    messages.push(...toolResults)
  }

  throw new StratumError(
    500,
    `Agent "${args.agentName}" exceeded maxTurns=${args.maxTurns}`,
  )
}
