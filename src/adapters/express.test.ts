import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { stratum, formation, StratumError } from '../index.js'
import { expressRoute } from './express.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const echoStratum = stratum({
  name: 'echo',
  provides: z.object({ message: z.string() }),
  requires: [],
  resolve: async () => ({ message: 'hello from strata' }),
})

const authStratum = stratum({
  name: 'auth',
  provides: z.object({ userId: z.string() }),
  requires: [],
  resolve: async ({ req }) => {
    const token = req.headers.get('authorization')
    if (!token) throw new StratumError(401, 'Unauthorized')
    return { userId: 'user_123' }
  },
})

const bodyStratum = stratum({
  name: 'body',
  provides: z.object({ name: z.string() }),
  requires: [],
  resolve: async ({ req }) => {
    const data = await req.json() as { name?: string }
    if (!data.name) throw new StratumError(400, 'name is required')
    return { name: data.name }
  },
})

// ─── expressRoute() ──────────────────────────────────────────────────────────

describe('expressRoute()', () => {
  it('returns a 200 response from a basic handler', async () => {
    const app = express()

    app.get('/hello', expressRoute({
      strata: [echoStratum],
      handler: async ({ context }) =>
        Response.json({ msg: context.echo.message }),
    }))

    const res = await request(app).get('/hello')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ msg: 'hello from strata' })
  })

  it('passes request headers into the web Request', async () => {
    const app = express()

    app.get('/auth', expressRoute({
      strata: [authStratum],
      handler: async ({ context }) =>
        Response.json({ userId: context.auth.userId }),
    }))

    const res = await request(app)
      .get('/auth')
      .set('Authorization', 'Bearer token123')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ userId: 'user_123' })
  })

  it('returns 401 when StratumError is thrown', async () => {
    const app = express()

    app.get('/auth', expressRoute({
      strata: [authStratum],
      handler: async ({ context }) =>
        Response.json({ userId: context.auth.userId }),
    }))

    const res = await request(app).get('/auth') // no auth header
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  it('handles POST with body-parser JSON body', async () => {
    const app = express()
    app.use(express.json())

    app.post('/greet', expressRoute({
      strata: [bodyStratum],
      handler: async ({ context }) =>
        Response.json({ hello: context.body.name }, { status: 201 }),
    }))

    const res = await request(app)
      .post('/greet')
      .send({ name: 'Alice' })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ hello: 'Alice' })
  })

  it('handles POST with raw body (no body-parser)', async () => {
    const app = express()
    // No express.json() — raw stream

    app.post('/greet', expressRoute({
      strata: [bodyStratum],
      handler: async ({ context }) =>
        Response.json({ hello: context.body.name }),
    }))

    const res = await request(app)
      .post('/greet')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ name: 'Bob' }))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ hello: 'Bob' })
  })

  it('returns 400 when body validation fails', async () => {
    const app = express()
    app.use(express.json())

    app.post('/greet', expressRoute({
      strata: [bodyStratum],
      handler: async ({ context }) =>
        Response.json({ hello: context.body.name }),
    }))

    const res = await request(app)
      .post('/greet')
      .send({}) // missing 'name'

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'name is required' })
  })

  it('passes multiple independent strata in parallel', async () => {
    const timings: string[] = []

    const slowStratum = stratum({
      name: 'slow',
      provides: z.object({ val: z.string() }),
      requires: [],
      resolve: async () => {
        timings.push('slow:start')
        await new Promise((r) => setTimeout(r, 20))
        timings.push('slow:end')
        return { val: 'slow' }
      },
    })

    const fastStratum = stratum({
      name: 'fast',
      provides: z.object({ val: z.string() }),
      requires: [],
      resolve: async () => {
        timings.push('fast:start')
        await new Promise((r) => setTimeout(r, 5))
        timings.push('fast:end')
        return { val: 'fast' }
      },
    })

    const app = express()
    app.get('/parallel', expressRoute({
      strata: [slowStratum, fastStratum],
      handler: async ({ context }) =>
        Response.json({ slow: context.slow.val, fast: context.fast.val }),
    }))

    const res = await request(app).get('/parallel')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ slow: 'slow', fast: 'fast' })

    // Both must have started before either ended (parallel execution)
    expect(timings.indexOf('slow:start')).toBeLessThan(timings.indexOf('fast:end'))
    expect(timings.indexOf('fast:start')).toBeLessThan(timings.indexOf('slow:end'))
  })

  it('works with formation()', async () => {
    const app = express()
    const f = formation([echoStratum])

    app.get('/formed', expressRoute({
      strata: f,
      handler: async ({ context }) =>
        Response.json({ msg: context.echo.message }),
    }))

    const res = await request(app).get('/formed')
    expect(res.status).toBe(200)
    expect(res.body.msg).toBe('hello from strata')
  })

  it('preserves response status codes', async () => {
    const app = express()

    app.get('/created', expressRoute({
      strata: [],
      handler: async () => Response.json({ created: true }, { status: 201 }),
    }))

    const res = await request(app).get('/created')
    expect(res.status).toBe(201)
  })

  it('preserves custom response headers', async () => {
    const app = express()

    app.get('/headers', expressRoute({
      strata: [],
      handler: async () =>
        new Response('ok', {
          headers: { 'x-custom-header': 'strata-rocks' },
        }),
    }))

    const res = await request(app).get('/headers')
    expect(res.headers['x-custom-header']).toBe('strata-rocks')
  })

  it('passes unknown errors to next()', async () => {
    const crashStratum = stratum({
      name: 'crash',
      provides: z.object({}),
      requires: [],
      resolve: async () => { throw new Error('unexpected boom') },
    })

    const app = express()

    app.get('/crash', expressRoute({
      strata: [crashStratum],
      handler: async () => Response.json({ ok: true }),
    }))

    // The route() wrapper converts unknown errors to 500 StratumErrors
    // before expressRoute even sees them, so we get a 500 JSON response
    const res = await request(app).get('/crash')
    expect(res.status).toBe(500)
  })
})

// ─── expressRoute.traced() ───────────────────────────────────────────────────

describe('expressRoute.traced()', () => {
  it('attaches X-Strata-Trace header', async () => {
    const app = express()

    app.get('/traced', expressRoute.traced({
      strata: [echoStratum],
      handler: async ({ context }) =>
        Response.json({ msg: context.echo.message }),
    }))

    const res = await request(app).get('/traced')
    expect(res.status).toBe(200)

    const trace = JSON.parse(res.headers['x-strata-trace'] ?? '{}')
    expect(trace).toHaveProperty('totalMs')
    expect(Array.isArray(trace.waves)).toBe(true)
    expect(trace.waves[0].parallel).toContain('echo')
  })
})
