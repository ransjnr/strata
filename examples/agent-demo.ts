/**
 * Strata agent demo — shows how to wire an LLM-powered stratum into a route.
 *
 * Run with: npx tsx examples/agent-demo.ts
 *
 * Requires:
 *   npm install @anthropic-ai/sdk
 *   ANTHROPIC_API_KEY in your environment
 */

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  agent,
  route,
  setDefaultProvider,
  stratum,
  tool,
  StratumError,
} from '@ransjnr/strata'
import { anthropicProvider } from '@ransjnr/strata/anthropic'

// 1. Configure provider once at startup.
setDefaultProvider(
  anthropicProvider({
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  }),
)

// 2. A normal stratum that pulls the request body.
const bodyStratum = stratum({
  name: 'body',
  provides: z.object({ text: z.string() }),
  requires: [],
  resolve: async ({ req }) => {
    const body = (await req.json().catch(() => null)) as { text?: unknown } | null
    if (!body || typeof body.text !== 'string') {
      throw new StratumError(400, 'Expected { text: string }')
    }
    return { text: body.text }
  },
})

// 3. A tool the agent can call.
const wordCountTool = tool({
  name: 'word_count',
  description: 'Count the words in a string of text.',
  input: z.object({ text: z.string() }),
  run: async ({ input }) => ({
    words: input.text.trim().split(/\s+/).filter(Boolean).length,
  }),
})

// 4. The agent itself — runs after `body` resolves.
const summarizer = agent({
  name: 'summary',
  provides: z.object({
    summary: z.string(),
    tags: z.array(z.string()).max(5),
    wordCount: z.number(),
  }),
  requires: [bodyStratum],
  model: 'claude-sonnet-4-6',
  system:
    'You are a concise summarizer. Use word_count to measure the input, then call submit_output with the summary.',
  prompt: ({ context }) => `Summarize and tag this text:\n\n${context.body.text}`,
  tools: [wordCountTool],
  maxTurns: 6,
})

// 5. Route — Strata runs body → summary, then your handler with typed context.
export const POST = route.traced({
  strata: [summarizer],
  handler: async ({ context }) =>
    Response.json({
      summary: context.summary.summary,
      tags: context.summary.tags,
      wordCount: context.summary.wordCount,
    }),
})

// 6. Smoke test (only when run directly).
if (require.main === module) {
  void (async () => {
    const res = await POST(
      new Request('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Strata is a declarative pipeline library that runs request concerns in parallel based on a typed dependency graph.',
        }),
      }),
    )
    console.log(res.status, await res.json())
    console.log('Trace:', res.headers.get('X-Strata-Trace'))
  })()
}
