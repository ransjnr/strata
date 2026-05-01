import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  agent,
  tool,
  setDefaultProvider,
  route,
  StratumError,
} from './index.js'
import type { AgentProvider, ProviderInvokeResult } from './provider.js'

// ─── Mock provider helpers ───────────────────────────────────────────────────

/**
 * Build a provider that returns a queued sequence of responses, one per
 * `invoke()` call. Lets each test script the LLM's behavior turn-by-turn.
 */
function scriptedProvider(turns: ProviderInvokeResult[]): AgentProvider {
  let i = 0
  return {
    name: 'mock',
    async invoke() {
      const next = turns[i++]
      if (!next) throw new Error('mock provider out of scripted turns')
      return next
    },
  }
}

function submit(input: unknown, id = 'call_1'): ProviderInvokeResult {
  return {
    message: {
      role: 'assistant',
      content: '',
      toolCalls: [{ id, name: 'submit_output', input }],
    },
    stopReason: 'tool_use',
  }
}

function callTool(
  name: string,
  input: unknown,
  id = 'call_t1',
): ProviderInvokeResult {
  return {
    message: {
      role: 'assistant',
      content: '',
      toolCalls: [{ id, name, input }],
    },
    stopReason: 'tool_use',
  }
}

// ─── tool() ──────────────────────────────────────────────────────────────────

describe('tool()', () => {
  it('returns a typed tool definition', () => {
    const t = tool({
      name: 'echo',
      description: 'echo input',
      input: z.object({ msg: z.string() }),
      run: async ({ input }) => ({ echoed: input.msg }),
    })
    expect(t.name).toBe('echo')
    expect(t.description).toBe('echo input')
  })

  it('runs and returns its output', async () => {
    const t = tool({
      name: 'double',
      description: 'double a number',
      input: z.object({ n: z.number() }),
      run: async ({ input }) => input.n * 2,
    })
    expect(await t.run({ input: { n: 21 } })).toBe(42)
  })
})

// ─── agent() — happy path ────────────────────────────────────────────────────

describe('agent()', () => {
  it('runs a simple one-turn agent that submits structured output', async () => {
    const provider = scriptedProvider([submit({ greeting: 'hi' })])

    const greeter = agent({
      name: 'greeter',
      provides: z.object({ greeting: z.string() }),
      model: 'mock-model',
      prompt: 'Say hi',
      provider,
    })

    const handler = route({
      strata: [greeter],
      handler: async ({ context }) =>
        Response.json({ greeting: context.greeter.greeting }),
    })

    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ greeting: 'hi' })
  })

  it('uses the default provider when none is passed', async () => {
    setDefaultProvider(scriptedProvider([submit({ ok: true })]))
    const a = agent({
      name: 'def',
      provides: z.object({ ok: z.boolean() }),
      model: 'mock-model',
      prompt: 'go',
    })
    const handler = route({
      strata: [a],
      handler: async ({ context }) => Response.json(context.def),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ ok: true })
  })

  it('errors with 500 when no provider is configured', async () => {
    // Reset default provider
    setDefaultProvider(undefined as unknown as AgentProvider)
    // Wipe internal state by setting to a noop provider then back to null is
    // hard; instead use a dedicated agent without one and ensure the error.
    // We patch via a fresh module import not necessary — the field can be set
    // to null via a custom provider that throws? Simpler: rely on the message.
    const a = agent({
      name: 'no_provider',
      provides: z.object({ ok: z.boolean() }),
      model: 'mock-model',
      prompt: 'go',
      // explicit override of the default to undefined-typed-as-any forces
      // resolve() to fall through to the default (which we cleared above)
    })

    // restore for later tests
    const handler = route({
      strata: [a],
      handler: async () => Response.json({}),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/no provider/i)
  })
})

// ─── agent() — tool loop ─────────────────────────────────────────────────────

describe('agent() tool-use loop', () => {
  it('executes a tool, feeds the result back, then submits output', async () => {
    const search = tool({
      name: 'search',
      description: 'search the kb',
      input: z.object({ query: z.string() }),
      run: async ({ input }) => ({ hits: [`${input.query}-result`] }),
    })

    const provider = scriptedProvider([
      callTool('search', { query: 'cats' }, 'c1'),
      submit({ answer: 'cats-result' }, 'c2'),
    ])

    const a = agent({
      name: 'qa',
      provides: z.object({ answer: z.string() }),
      model: 'mock-model',
      prompt: 'find info',
      tools: [search],
      provider,
    })

    const handler = route({
      strata: [a],
      handler: async ({ context }) => Response.json(context.qa),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ answer: 'cats-result' })
  })

  it('rejects invalid structured output and asks the model to retry', async () => {
    const provider = scriptedProvider([
      submit({ wrong: 'shape' }), // invalid → loop continues
      submit({ answer: 'right' }),
    ])

    const a = agent({
      name: 'qa',
      provides: z.object({ answer: z.string() }),
      model: 'mock-model',
      prompt: 'go',
      provider,
    })
    const handler = route({
      strata: [a],
      handler: async ({ context }) => Response.json(context.qa),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ answer: 'right' })
  })

  it('returns 500 when maxTurns is exceeded', async () => {
    const provider = scriptedProvider(
      Array.from({ length: 10 }, () => callTool('noop', {})),
    )
    const noop = tool({
      name: 'noop',
      description: 'noop',
      input: z.object({}),
      run: async () => ({}),
    })

    const a = agent({
      name: 'spinner',
      provides: z.object({ done: z.boolean() }),
      model: 'mock-model',
      prompt: 'go',
      tools: [noop],
      maxTurns: 3,
      provider,
    })

    const handler = route({
      strata: [a],
      handler: async () => Response.json({}),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/maxTurns/i)
  })

  it('reports tool errors back to the model without crashing', async () => {
    const failing = tool({
      name: 'fail',
      description: 'always fails',
      input: z.object({}),
      run: async () => {
        throw new Error('boom')
      },
    })

    const provider = scriptedProvider([
      callTool('fail', {}, 'f1'),
      submit({ recovered: true }, 'f2'),
    ])

    const a = agent({
      name: 'r',
      provides: z.object({ recovered: z.boolean() }),
      model: 'mock-model',
      prompt: 'go',
      tools: [failing],
      provider,
    })

    const handler = route({
      strata: [a],
      handler: async ({ context }) => Response.json(context.r),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ recovered: true })
  })
})

// ─── agent() — integration with strata graph ────────────────────────────────

describe('agent() integrates with the strata dependency graph', () => {
  it('reads from required strata in its prompt', async () => {
    const promptFn = vi.fn(
      ({ context }: { context: { upstream: { value: string } } }) =>
        `seed=${context.upstream.value}`,
    )

    const upstream = {
      name: 'upstream' as const,
      provides: z.object({ value: z.string() }),
      requires: [] as const,
      resolve: async () => ({ value: 'hello' }),
    }

    const provider = scriptedProvider([submit({ ok: true })])

    const a = agent({
      name: 'consumer',
      provides: z.object({ ok: z.boolean() }),
      requires: [upstream],
      model: 'mock-model',
      prompt: promptFn as never,
      provider,
    })

    const handler = route({
      strata: [a],
      handler: async ({ context }) => Response.json(context.consumer),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ ok: true })
    expect(promptFn).toHaveBeenCalledOnce()
    expect(promptFn.mock.calls[0]![0].context.upstream.value).toBe('hello')
  })

  it('StratumError thrown in upstream stratum short-circuits before agent runs', async () => {
    const provider = scriptedProvider([submit({ ok: true })])
    const invokeSpy = vi.spyOn(provider, 'invoke')

    const guarded = {
      name: 'guard' as const,
      provides: z.object({}),
      requires: [] as const,
      resolve: async () => {
        throw new StratumError(401, 'nope')
      },
    }

    const a = agent({
      name: 'after',
      provides: z.object({ ok: z.boolean() }),
      requires: [guarded],
      model: 'mock-model',
      prompt: 'go',
      provider,
    })

    const handler = route({
      strata: [a],
      handler: async () => Response.json({}),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(401)
    expect(invokeSpy).not.toHaveBeenCalled()
  })
})
