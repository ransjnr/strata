import type { StrataTrace, StratumNode } from './types'

/**
 * Converts a raw StrataTrace into a flat list of StratumNodes with
 * absolute timing (startMs / endMs) relative to the start of the request.
 */
export function parseTrace(trace: StrataTrace): StratumNode[] {
  const nodes: StratumNode[] = []
  let cursor = 0

  trace.waves.forEach((wave, waveIndex) => {
    const start = cursor
    const end = cursor + wave.ms

    wave.parallel.forEach((name) => {
      nodes.push({ name, waveIndex, startMs: start, endMs: end })
    })

    cursor = end
  })

  return nodes
}

/** A small set of demo traces for the playground tab */
export const DEMO_TRACES: { label: string; trace: StrataTrace }[] = [
  {
    label: 'GET /api/posts',
    trace: {
      totalMs: 73,
      waves: [
        { parallel: ['logging', 'auth'], ms: 48 },
        { parallel: ['rateLimit'], ms: 15 },
        { parallel: ['dbQuery'], ms: 10 },
      ],
    },
  },
  {
    label: 'DELETE /api/posts (admin)',
    trace: {
      totalMs: 95,
      waves: [
        { parallel: ['logging', 'auth'], ms: 51 },
        { parallel: ['rateLimit', 'permission'], ms: 22 },
        { parallel: ['dbDelete'], ms: 22 },
      ],
    },
  },
  {
    label: 'POST /api/users (no auth)',
    trace: {
      totalMs: 18,
      waves: [
        { parallel: ['logging', 'bodyValidation'], ms: 12 },
        { parallel: ['dbInsert'], ms: 6 },
      ],
    },
  },
]
