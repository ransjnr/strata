import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { stratum, route, formation, StratumError, isStratumError } from './index.js'
import { collectAllStrata, assertNoCycles, executeStrata } from './executor.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(url = 'http://localhost/test', init?: RequestInit) {
  return new Request(url, init)
}

// ─── stratum() ───────────────────────────────────────────────────────────────

describe('stratum()', () => {
  it('creates a stratum with correct shape', () => {
    const s = stratum({
      name: 'test',
      provides: z.object({ value: z.number() }),
      requires: [],
      resolve: async () => ({ value: 42 }),
    })

    expect(s.name).toBe('test')
    expect(s.requires).toEqual([])
  })

  it('resolve returns expected output', async () => {
    const s = stratum({
      name: 'test',
      provides: z.object({ value: z.number() }),
      requires: [],
      resolve: async () => ({ value: 7 }),
    })

    const result = await s.resolve({ req: makeRequest(), context: {} as never })
    expect(result).toEqual({ value: 7 })
  })
})

// ─── StratumError ────────────────────────────────────────────────────────────

describe('StratumError', () => {
  it('toResponse() returns correct status and JSON body', async () => {
    const err = new StratumError(401, 'Unauthorized')
    const res = err.toResponse()

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('accepts a custom body', async () => {
    const err = new StratumError(429, 'Rate limited', { code: 'RATE_LIMIT', retryAfter: 60 })
    const res = err.toResponse()
    expect(await res.json()).toEqual({ code: 'RATE_LIMIT', retryAfter: 60 })
  })

  it('isStratumError() type guard works', () => {
    expect(isStratumError(new StratumError(400, 'bad'))).toBe(true)
    expect(isStratumError(new Error('regular'))).toBe(false)
    expect(isStratumError(null)).toBe(false)
  })
})

// ─── Executor: collectAllStrata ──────────────────────────────────────────────

describe('collectAllStrata()', () => {
  it('returns strata in dependency order', () => {
    const a = stratum({ name: 'a', provides: z.object({}), requires: [], resolve: async () => ({}) })
    const b = stratum({ name: 'b', provides: z.object({}), requires: [a], resolve: async () => ({}) })
    const c = stratum({ name: 'c', provides: z.object({}), requires: [b], resolve: async () => ({}) })

    const all = collectAllStrata([c])
    expect(all.map((s) => s.name)).toEqual(['a', 'b', 'c'])
  })

  it('deduplicates shared dependencies', () => {
    const shared = stratum({ name: 'shared', provides: z.object({}), requires: [], resolve: async () => ({}) })
    const x = stratum({ name: 'x', provides: z.object({}), requires: [shared], resolve: async () => ({}) })
    const y = stratum({ name: 'y', provides: z.object({}), requires: [shared], resolve: async () => ({}) })

    const all = collectAllStrata([x, y])
    expect(all.filter((s) => s.name === 'shared')).toHaveLength(1)
  })
})

// ─── Executor: cycle detection ───────────────────────────────────────────────

describe('assertNoCycles()', () => {
  it('throws on direct cycle', () => {
    // Can't use stratum() for cycles since TS won't let us, so test manually
    const a: any = { name: 'a', requires: [] }
    const b: any = { name: 'b', requires: [a] }
    a.requires = [b] // create cycle

    expect(() => assertNoCycles([a, b])).toThrow(/circular dependency/)
  })
})

// ─── Executor: parallel execution ────────────────────────────────────────────

describe('executeStrata()', () => {
  it('executes independent strata in parallel (both start before either resolves)', async () => {
    const order: string[] = []

    const a = stratum({
      name: 'a',
      provides: z.object({ a: z.number() }),
      requires: [],
      resolve: async () => {
        order.push('a:start')
        await new Promise((r) => setTimeout(r, 10))
        order.push('a:end')
        return { a: 1 }
      },
    })

    const b = stratum({
      name: 'b',
      provides: z.object({ b: z.number() }),
      requires: [],
      resolve: async () => {
        order.push('b:start')
        await new Promise((r) => setTimeout(r, 10))
        order.push('b:end')
        return { b: 2 }
      },
    })

    await executeStrata([a, b], makeRequest())

    // Both must start before either ends (true parallelism)
    expect(order.indexOf('a:start')).toBeLessThan(order.indexOf('b:end'))
    expect(order.indexOf('b:start')).toBeLessThan(order.indexOf('a:end'))
  })

  it('passes resolved deps to dependent strata', async () => {
    const auth = stratum({
      name: 'auth',
      provides: z.object({ userId: z.string() }),
      requires: [],
      resolve: async () => ({ userId: 'u_42' }),
    })

    const rateLimit = stratum({
      name: 'rateLimit',
      provides: z.object({ remaining: z.number() }),
      requires: [auth],
      resolve: async ({ context }) => {
        // context.auth.userId must be available here
        expect(context.auth.userId).toBe('u_42')
        return { remaining: 99 }
      },
    })

    const ctx = await executeStrata([auth, rateLimit], makeRequest())
    expect(ctx['rateLimit']).toEqual({ remaining: 99 })
  })

  it('accumulates all outputs in context', async () => {
    const x = stratum({ name: 'x', provides: z.object({ v: z.literal('x') }), requires: [], resolve: async () => ({ v: 'x' as const }) })
    const y = stratum({ name: 'y', provides: z.object({ v: z.literal('y') }), requires: [], resolve: async () => ({ v: 'y' as const }) })

    const ctx = await executeStrata([x, y], makeRequest())
    expect(ctx).toMatchObject({ x: { v: 'x' }, y: { v: 'y' } })
  })
})

// ─── route() ─────────────────────────────────────────────────────────────────

describe('route()', () => {
  it('returns a Response from the handler', async () => {
    const s = stratum({
      name: 'greeting',
      provides: z.object({ hello: z.string() }),
      requires: [],
      resolve: async () => ({ hello: 'world' }),
    })

    const handler = route({
      strata: [s],
      handler: async ({ context }) => Response.json({ msg: context.greeting.hello }),
    })

    const res = await handler(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ msg: 'world' })
  })

  it('converts StratumError to HTTP response', async () => {
    const s = stratum({
      name: 'guard',
      provides: z.object({}),
      requires: [],
      resolve: async () => { throw new StratumError(403, 'Forbidden') },
    })

    const handler = route({
      strata: [s],
      handler: async () => Response.json({ ok: true }),
    })

    const res = await handler(makeRequest())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('converts unexpected errors to 500', async () => {
    const s = stratum({
      name: 'boom',
      provides: z.object({}),
      requires: [],
      resolve: async () => { throw new Error('something exploded') },
    })

    const handler = route({
      strata: [s],
      handler: async () => Response.json({ ok: true }),
    })

    const res = await handler(makeRequest())
    expect(res.status).toBe(500)
  })

  it('route.traced() attaches X-Strata-Trace header', async () => {
    const s = stratum({
      name: 'noop',
      provides: z.object({}),
      requires: [],
      resolve: async () => ({}),
    })

    const handler = route.traced({
      strata: [s],
      handler: async () => Response.json({ ok: true }),
    })

    const res = await handler(makeRequest())
    const trace = JSON.parse(res.headers.get('X-Strata-Trace') ?? '{}')
    expect(trace).toHaveProperty('totalMs')
    expect(trace.waves).toHaveLength(1)
    expect(trace.waves[0]?.parallel).toEqual(['noop'])
  })
})

// ─── formation() ─────────────────────────────────────────────────────────────

describe('formation()', () => {
  it('returns the strata array unchanged', () => {
    const a = stratum({ name: 'a', provides: z.object({}), requires: [], resolve: async () => ({}) })
    const b = stratum({ name: 'b', provides: z.object({}), requires: [], resolve: async () => ({}) })
    const f = formation([a, b])
    expect(f).toEqual([a, b])
  })

  it('works as strata in route()', async () => {
    const ping = stratum({
      name: 'ping',
      provides: z.object({ ok: z.boolean() }),
      requires: [],
      resolve: async () => ({ ok: true }),
    })

    const f = formation([ping])
    const handler = route({
      strata: f,
      handler: async ({ context }) => Response.json(context.ping),
    })

    const res = await handler(makeRequest())
    expect(await res.json()).toEqual({ ok: true })
  })
})
