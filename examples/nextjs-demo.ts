/**
 * Strata — Next.js App Router demo
 *
 * This file shows what a real API route looks like with Strata.
 * It would live at:  app/api/posts/route.ts
 *
 * Execution graph for GET /api/posts:
 *
 *   loggingStratum ────────────────────────────────────┐
 *                                                       ▼
 *   authStratum ──────► rateLimitStratum ──────────► handler
 *
 *   (logging + auth run in PARALLEL — no dependency between them)
 *   (rateLimitStratum waits for auth, then runs)
 *   (handler receives fully typed context from all three)
 */

import { stratum, route, formation, StratumError } from '../src/index.js'
import { z } from 'zod'

// ─── Strata definitions ──────────────────────────────────────────────────────
// These would normally live in separate files, e.g. strata/auth.ts

/**
 * loggingStratum — assigns a requestId, logs the incoming request.
 * No dependencies. Runs in parallel with authStratum.
 */
const loggingStratum = stratum({
  name: 'logging',
  provides: z.object({
    requestId: z.string(),
    startedAt: z.number(),
  }),
  requires: [],
  resolve: async ({ req }) => {
    const requestId = crypto.randomUUID()
    const startedAt = Date.now()
    console.log(`[${requestId}] ${req.method} ${new URL(req.url).pathname}`)
    return { requestId, startedAt }
  },
})

/**
 * authStratum — verifies JWT, attaches typed user to context.
 * No dependencies. Runs in parallel with loggingStratum.
 * Throws StratumError(401) if token is missing/invalid.
 */
const authStratum = stratum({
  name: 'auth',
  provides: z.object({
    user: z.object({
      id: z.string(),
      email: z.string().email(),
      role: z.enum(['admin', 'user', 'guest']),
    }),
  }),
  requires: [],
  resolve: async ({ req }) => {
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) throw new StratumError(401, 'Missing authorization header')

    // In real code: const payload = await verifyJwt(token)
    const user = await mockVerifyToken(token)
    if (!user) throw new StratumError(401, 'Invalid or expired token')

    return { user }
  },
})

/**
 * rateLimitStratum — checks per-user rate limit.
 * Requires authStratum (needs user.id to key the limit).
 * Runs AFTER auth resolves, but in parallel with logging.
 */
const rateLimitStratum = stratum({
  name: 'rateLimit',
  provides: z.object({
    remaining: z.number(),
    resetAt: z.number(),
  }),
  requires: [authStratum],          // ← TypeScript: context.auth is typed here
  resolve: async ({ context }) => {
    // context.auth.user.id is fully typed — TS error if you typo it
    const { remaining, resetAt } = await mockCheckRateLimit(context.auth.user.id)

    if (remaining <= 0) {
      throw new StratumError(
        429,
        'Rate limit exceeded',
        { error: 'rate_limit_exceeded', resetAt },
      )
    }

    return { remaining, resetAt }
  },
})

/**
 * permissionStratum — checks that the user has a required role.
 * Requires authStratum. Reusable across many routes.
 */
function requireRole(role: 'admin' | 'user') {
  return stratum({
    name: 'permission',
    provides: z.object({ granted: z.literal(true) }),
    requires: [authStratum],
    resolve: async ({ context }) => {
      const { user } = context.auth
      const hierarchy = { admin: 2, user: 1, guest: 0 }
      if ((hierarchy[user.role] ?? 0) < hierarchy[role]) {
        throw new StratumError(403, `Requires role: ${role}`)
      }
      return { granted: true as const }
    },
  })
}

// ─── Reusable formation ──────────────────────────────────────────────────────

/**
 * Standard API formation — apply to any route that needs auth + rate limiting.
 * Spread into `strata: [...]` or use directly.
 */
const apiFormation = formation([loggingStratum, authStratum, rateLimitStratum])

// ─── Route handlers ──────────────────────────────────────────────────────────

/**
 * GET /api/posts — list posts (any authenticated user)
 *
 * Context available in handler:
 *   context.logging  → { requestId: string, startedAt: number }
 *   context.auth     → { user: { id, email, role } }
 *   context.rateLimit → { remaining: number, resetAt: number }
 */
export const GET = route({
  strata: apiFormation,
  handler: async ({ req, context }) => {
    const { searchParams } = new URL(req.url)
    const page = Number(searchParams.get('page') ?? 1)

    const posts = await mockGetPosts(context.auth.user.id, page)

    return Response.json({
      posts,
      meta: {
        requestId: context.logging.requestId,
        rateLimit: { remaining: context.rateLimit.remaining },
      },
    })
  },
})

/**
 * DELETE /api/posts — delete a post (admin only)
 *
 * Adds permissionStratum on top of the standard formation.
 */
export const DELETE = route({
  strata: [...apiFormation, requireRole('admin')],
  handler: async ({ req, context }) => {
    const { id } = await req.json() as { id: string }
    await mockDeletePost(id, context.auth.user.id)
    return Response.json({ deleted: true, requestId: context.logging.requestId })
  },
})

// ─── Mock helpers (stand-ins for real DB/auth calls) ────────────────────────

async function mockVerifyToken(token: string) {
  if (token === 'valid-token') {
    return { id: 'user_123', email: 'alice@example.com', role: 'admin' as const }
  }
  return null
}

async function mockCheckRateLimit(_userId: string) {
  return { remaining: 99, resetAt: Date.now() + 60_000 }
}

async function mockGetPosts(_userId: string, _page: number) {
  return [{ id: '1', title: 'Hello Strata' }]
}

async function mockDeletePost(_id: string, _userId: string) {
  return true
}
