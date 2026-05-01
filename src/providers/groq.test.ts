import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { agent, route, tool } from '../index.js'
import { groqProvider } from './groq.js'

// ─── Mock Groq client ────────────────────────────────────────────────────────

interface GroqToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface GroqResponse {
  choices: {
    message: {
      role: string
      content: string | null
      tool_calls?: GroqToolCall[]
    }
    finish_reason: string | null
  }[]
}

function mockGroqClient(responses: GroqResponse[]) {
  let i = 0
  const create = vi.fn(async () => {
    const next = responses[i++]
    if (!next) throw new Error('mock client out of scripted responses')
    return next
  })
  return {
    create,
    client: {
      chat: { completions: { create } },
    },
  }
}

function tcSubmit(input: unknown, id = 'call_submit'): GroqResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: {
                name: 'submit_output',
                arguments: JSON.stringify(input),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
}

function tcCall(name: string, input: unknown, id = 'call_t'): GroqResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name, arguments: JSON.stringify(input) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('groqProvider', () => {
  it('exposes name "groq"', () => {
    const { client } = mockGroqClient([])
    const p = groqProvider({ client })
    expect(p.name).toBe('groq')
  })

  it('runs a one-turn agent that submits structured output', async () => {
    const { client, create } = mockGroqClient([tcSubmit({ greeting: 'hi' })])
    const provider = groqProvider({ client })

    const greeter = agent({
      name: 'greeter',
      provides: z.object({ greeting: z.string() }),
      model: 'llama-3.3-70b-versatile',
      system: 'be friendly',
      prompt: 'greet',
      provider,
    })

    const handler = route({
      strata: [greeter],
      handler: async ({ context }) => Response.json(context.greeter),
    })

    const res = await handler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ greeting: 'hi' })
    expect(create).toHaveBeenCalledOnce()

    // The system message must be present at index 0.
    const params = (create.mock.calls[0] as unknown as [
      {
        messages: { role: string; content?: string }[]
        tools: { type: string; function: { name: string } }[]
      },
    ])[0]
    expect(params.messages[0]).toMatchObject({
      role: 'system',
      content: 'be friendly',
    })
    expect(params.messages[1]).toMatchObject({
      role: 'user',
      content: 'greet',
    })
    // submit_output is auto-injected as a tool.
    expect(params.tools.map((t) => t.function.name)).toContain('submit_output')
  })

  it('runs a tool, feeds the result back, then submits output', async () => {
    const search = tool({
      name: 'search',
      description: 'search the kb',
      input: z.object({ query: z.string() }),
      run: async ({ input }) => ({ hit: `${input.query}!` }),
    })

    const { client, create } = mockGroqClient([
      tcCall('search', { query: 'cats' }, 'c1'),
      tcSubmit({ answer: 'cats!' }, 'c2'),
    ])
    const provider = groqProvider({ client })

    const a = agent({
      name: 'qa',
      provides: z.object({ answer: z.string() }),
      model: 'llama-3.3-70b-versatile',
      prompt: 'find',
      tools: [search],
      provider,
    })

    const handler = route({
      strata: [a],
      handler: async ({ context }) => Response.json(context.qa),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ answer: 'cats!' })

    // Second call should include the assistant tool_call + tool result.
    const secondCall = (create.mock.calls[1] as unknown as [
      {
        messages: { role: string; tool_call_id?: string; content?: string }[]
      },
    ])[0]
    const toolMsg = secondCall.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.tool_call_id).toBe('c1')
    expect(toolMsg?.content).toContain('cats!')
  })

  it('translates Zod schemas into JSON Schema tool parameters', async () => {
    const echo = tool({
      name: 'echo',
      description: 'echoes',
      input: z.object({
        msg: z.string(),
        count: z.number(),
        flag: z.boolean(),
      }),
      run: async ({ input }) => input,
    })

    const { client, create } = mockGroqClient([tcSubmit({ ok: true })])
    const provider = groqProvider({ client })

    const a = agent({
      name: 'a',
      provides: z.object({ ok: z.boolean() }),
      model: 'llama-3.3-70b-versatile',
      prompt: 'go',
      tools: [echo],
      provider,
    })

    const handler = route({
      strata: [a],
      handler: async () => Response.json({}),
    })
    await handler(new Request('http://localhost/'))

    const params = (create.mock.calls[0] as unknown as [
      {
        tools: {
          function: {
            name: string
            parameters: {
              type: string
              properties: Record<string, { type: string }>
              required?: string[]
            }
          }
        }[]
      },
    ])[0]
    const echoTool = params.tools.find((t) => t.function.name === 'echo')!
    expect(echoTool.function.parameters.type).toBe('object')
    expect(echoTool.function.parameters.properties.msg!.type).toBe('string')
    expect(echoTool.function.parameters.properties.count!.type).toBe('number')
    expect(echoTool.function.parameters.properties.flag!.type).toBe('boolean')
    expect(echoTool.function.parameters.required).toEqual([
      'msg',
      'count',
      'flag',
    ])
  })

  it('handles plain end_turn responses by nudging the model', async () => {
    const endTurn: GroqResponse = {
      choices: [
        {
          message: { role: 'assistant', content: 'Sure!' },
          finish_reason: 'stop',
        },
      ],
    }

    const { client } = mockGroqClient([endTurn, tcSubmit({ ok: true })])
    const provider = groqProvider({ client })

    const a = agent({
      name: 'a',
      provides: z.object({ ok: z.boolean() }),
      model: 'llama-3.3-70b-versatile',
      prompt: 'go',
      provider,
    })

    const handler = route({
      strata: [a],
      handler: async ({ context }) => Response.json(context.a),
    })
    const res = await handler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ ok: true })
  })
})
