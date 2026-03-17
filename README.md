# Strata

**Declarative, type-safe, parallel request pipelines — a better alternative to middleware.**

```
npm install @ransjnr/strata zod
```

> Middleware says *"do these things in this order."*
> Strata says *"here's what I need and what I provide — you figure out the order."*

---

## Table of Contents

- [Why not middleware?](#why-not-middleware)
- [Core idea](#core-idea)
- [Installation](#installation)
- [Quick start](#quick-start)
- [API reference](#api-reference)
  - [stratum()](#stratum)
  - [route()](#route)
  - [route.traced()](#routetraced)
  - [formation()](#formation)
  - [StratumError](#stratumerror)
- [How the executor works](#how-the-executor-works)
- [Recipes](#recipes)
  - [Logging](#logging-stratum)
  - [Authentication](#authentication-stratum)
  - [Rate limiting](#rate-limiting-stratum)
  - [Role-based permissions](#role-based-permissions)
  - [Request validation](#request-body-validation)
- [Reusable formations](#reusable-formations)
- [Using with Next.js App Router](#using-with-nextjs-app-router)
- [Using with Cloudflare Workers / Hono](#using-with-cloudflare-workers--hono)
- [TypeScript types](#typescript-types)
- [Development and debugging](#development-and-debugging)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Why not middleware?

Traditional middleware chains are simple to start with and painful to scale. Here are the specific problems Strata was built to solve.

### Problem 1 — Everything runs in a single line

Middleware is a queue. Every concern waits for the one before it, even when they have nothing to do with each other.

```
Request → Logger (30ms) → Auth (50ms) → RateLimit (20ms) → Handler
                                                             Total: 100ms
```

Logging and authentication are completely independent. They could run at the same time. But middleware has no way to express that.

With Strata, independent concerns run in parallel automatically:

```
Wave 1:  Logger + Auth run together (50ms)
Wave 2:  RateLimit runs after Auth (20ms)
Wave 3:  Handler runs (context is ready)
                                         Total: 70ms
```

No special configuration. Just declare your dependencies honestly and Strata finds the fastest valid execution order.

### Problem 2 — Passing data between layers requires mutation hacks

Auth middleware figures out who the user is. Your route handler needs that user. In Express and Next.js the common answer is to mutate the request object:

```typescript
// Express middleware
app.use((req, res, next) => {
  req.user = decodeToken(req.headers.authorization) // mutate request
  next()
})

// Route handler
app.get('/me', (req, res) => {
  console.log(req.user?.name) // hope it's there. TypeScript has no idea.
})
```

This pattern has no contract. TypeScript doesn't know `req.user` exists. You get `any` types, `undefined` surprises, and no way for the type system to verify correctness.

Strata gives every concern a typed `provides` declaration. Your handler receives a fully inferred `context` object — TypeScript knows exactly what's in it because the types flow from the strata definitions.

### Problem 3 — One file for everything (Next.js)

Next.js gives you a single `middleware.ts` at the project root. All routing concerns live there: auth guards, redirects, locale detection, A/B testing, bot protection. This file grows without bound and can't be co-located with the routes it protects.

Strata lets you define concerns anywhere and compose them directly in each route file.

### Problem 4 — Order is invisible

If you register rate limiting before authentication, anonymous requests eat into your rate limit budget. The correct order lives only in your head — nothing in the code enforces or explains it.

With `requires`, dependencies are explicit. Strata enforces the correct order structurally and detects cycles at startup.

---

## Core idea

Each concern in Strata is called a **stratum**. A stratum is a small, self-contained unit that:

1. **Provides** — declares the typed data it will produce (a Zod schema)
2. **Requires** — lists other strata it depends on
3. **Resolves** — an async function that produces its output

```
stratum = provides + requires + resolve
```

When you build a `route`, you hand it a list of strata. Strata reads the dependency graph, executes strata in the fastest valid order, and passes a fully typed context to your handler.

---

## Installation

```bash
npm install @ransjnr/strata zod
# or
pnpm add @ransjnr/strata zod
# or
yarn add @ransjnr/strata zod
```

Strata requires **Zod v3** as a peer dependency for schema declarations. TypeScript 5.0+ is recommended for best type inference.

---

## Quick start

```typescript
import { stratum, route, StratumError } from '@ransjnr/strata'
import { z } from 'zod'

// 1. Define a concern
const authStratum = stratum({
  name: 'auth',
  provides: z.object({
    user: z.object({ id: z.string(), role: z.enum(['admin', 'user']) }),
  }),
  requires: [],
  resolve: async ({ req }) => {
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) throw new StratumError(401, 'Missing token')
    const user = await verifyToken(token) // your auth logic
    if (!user) throw new StratumError(401, 'Invalid token')
    return { user }
  },
})

// 2. Use it in a route
export const GET = route({
  strata: [authStratum],
  handler: async ({ req, context }) => {
    // context.auth.user is fully typed — no casting needed
    return Response.json({ hello: context.auth.user.id })
  },
})
```

---

## API reference

### `stratum()`

Defines a single pipeline concern.

```typescript
function stratum<Name, Provides, Deps>(config: {
  name: Name            // unique string identifier
  provides: Provides    // Zod schema describing what this stratum outputs
  requires: Deps        // array of other StratumDef this stratum depends on
  resolve(args: {
    req: Request
    context: DepsContext<Deps>  // typed output of all required strata
  }): Promise<z.infer<Provides>>
}): StratumDef<Name, Provides, Deps>
```

**Parameters**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique name. Used as the key in the route context object. |
| `provides` | `z.ZodObject` | Zod schema. The shape returned by `resolve`. |
| `requires` | `StratumDef[]` | Other strata this one depends on. Their output is in `context`. |
| `resolve` | `async fn` | Performs the work. Receives `req` and typed `context` from deps. |

**Throwing errors**

Throw `StratumError` inside `resolve` to short-circuit the entire pipeline and return an HTTP error response immediately. No other strata or the handler will run.

```typescript
if (!token) throw new StratumError(401, 'Unauthorized')
```

Any unhandled `Error` (not a `StratumError`) will become a `500 Internal Server Error` response.

**Example — a stratum with a dependency**

```typescript
const rateLimitStratum = stratum({
  name: 'rateLimit',
  provides: z.object({ remaining: z.number() }),
  requires: [authStratum],          // depends on auth
  resolve: async ({ context }) => {
    // context.auth is fully typed here because authStratum is in requires
    const remaining = await checkLimit(context.auth.user.id)
    if (remaining <= 0) throw new StratumError(429, 'Rate limit exceeded')
    return { remaining }
  },
})
```

---

### `route()`

Composes strata into a standard route handler function.

```typescript
function route<Strata>(def: {
  strata: Strata                              // array of StratumDef
  handler(args: {
    req: Request
    context: RouteContext<Strata>             // fully typed union of all strata outputs
  }): Promise<Response>
}): (req: Request) => Promise<Response>
```

Returns a `(req: Request) => Promise<Response>` function — the standard signature used by Next.js App Router, Cloudflare Workers, Hono, and any runtime using the web Fetch API.

```typescript
// app/api/posts/route.ts
export const GET = route({
  strata: [loggingStratum, authStratum, rateLimitStratum],
  handler: async ({ req, context }) => {
    // All three strata outputs are available and typed:
    context.logging.requestId    // string
    context.auth.user.role       // 'admin' | 'user'
    context.rateLimit.remaining  // number

    return Response.json({ ok: true })
  },
})
```

**Error handling**

- `StratumError` thrown from any stratum → short-circuits to that HTTP response
- Any other `Error` → becomes `500 { "error": "..." }`
- Both are caught transparently — you don't write try/catch in handlers

---

### `route.traced()`

Same as `route()` but attaches an `X-Strata-Trace` response header with execution timing. Use this during development to see which strata ran in parallel and how long each wave took.

```typescript
// dev-only: swap route() for route.traced()
export const GET = route.traced({
  strata: [loggingStratum, authStratum, rateLimitStratum],
  handler: async ({ context }) => Response.json({ ok: true }),
})
```

**Response header**

```json
X-Strata-Trace: {
  "totalMs": 63,
  "waves": [
    { "parallel": ["logging", "auth"], "ms": 48 },
    { "parallel": ["rateLimit"],       "ms": 15 }
  ]
}
```

This is the foundation for the upcoming visual devtools panel.

---

### `formation()`

Bundles a set of strata into a reusable, named group.

```typescript
function formation<Strata extends readonly AnyStratumDef[]>(
  strata: Strata
): Strata
```

A formation is just a typed tuple of strata. Use it to define common combinations once and share them across routes.

```typescript
// strata/formations.ts
export const apiFormation = formation([
  loggingStratum,
  authStratum,
  rateLimitStratum,
])

// Any route can use it
export const GET = route({
  strata: apiFormation,
  handler: async ({ context }) => { ... },
})

// Add extra strata on top for specific routes
export const DELETE = route({
  strata: [...apiFormation, requireRole('admin')],
  handler: async ({ context }) => { ... },
})
```

---

### `StratumError`

Thrown inside `resolve` to short-circuit the pipeline and produce a specific HTTP error response.

```typescript
class StratumError extends Error {
  constructor(
    status: number,    // HTTP status code
    message: string,   // error message (also used as response body if no body given)
    body?: unknown     // optional custom JSON response body
  )
}
```

**Examples**

```typescript
// Simple — response body becomes { "error": "Unauthorized" }
throw new StratumError(401, 'Unauthorized')

// Custom body
throw new StratumError(429, 'Rate limit exceeded', {
  error: 'rate_limit_exceeded',
  resetAt: 1710000000000,
})

// Forbidden
throw new StratumError(403, 'Requires admin role')
```

**`isStratumError(err)`** — type guard utility:

```typescript
import { isStratumError } from 'strata'

if (isStratumError(err)) {
  console.log(err.status) // number
}
```

---

## How the executor works

When a request arrives, Strata runs your strata using a **parallel wave executor**. Understanding this is the key to getting the most out of Strata.

### Step 1 — Collect all strata (including transitive deps)

The executor walks your strata and their `requires` arrays recursively, deduplicating by name. You never have to manually specify transitive dependencies.

```typescript
// If rateLimitStratum requires authStratum, and you only list rateLimitStratum,
// Strata will still run authStratum first — it found it through the graph.
route({ strata: [rateLimitStratum], handler: ... })
//                   ↑
//      authStratum is discovered and run automatically
```

### Step 2 — Check for cycles

Before execution starts, Strata runs a depth-first cycle detection pass. If your graph has a cycle (A requires B, B requires A), it throws immediately with a descriptive error:

```
Strata: circular dependency detected at "auth". Cycle path: auth → session → auth
```

### Step 3 — Execute in waves

The executor repeatedly finds **ready** strata — those whose every dependency is already resolved — and runs them all with `Promise.all`. This is true I/O parallelism.

```
Iteration 1: find strata with no unresolved deps → [logging, auth]
             run both with Promise.all
             mark both resolved

Iteration 2: find strata whose deps are now resolved → [rateLimit]
             run it
             mark resolved

Iteration 3: all resolved → pass context to handler
```

### Step 4 — Build and pass typed context

Every stratum's output is merged into a `context` object keyed by name. TypeScript infers this type from your strata declarations — no casting, no `any`.

```typescript
// What TypeScript sees at compile time:
context: {
  logging:   { requestId: string, startedAt: number }
  auth:      { user: { id: string, email: string, role: 'admin' | 'user' | 'guest' } }
  rateLimit: { remaining: number, resetAt: number }
}
```

---

## Recipes

These are production-ready strata you can copy, adapt, and use directly.

### Logging stratum

```typescript
// strata/logging.ts
import { stratum } from 'strata'
import { z } from 'zod'

export const loggingStratum = stratum({
  name: 'logging',
  provides: z.object({
    requestId: z.string(),
    startedAt: z.number(),
  }),
  requires: [],
  resolve: async ({ req }) => {
    const requestId = crypto.randomUUID()
    const startedAt = Date.now()
    const { pathname } = new URL(req.url)
    console.log(`→ [${requestId}] ${req.method} ${pathname}`)
    return { requestId, startedAt }
  },
})
```

---

### Authentication stratum

```typescript
// strata/auth.ts
import { stratum, StratumError } from 'strata'
import { z } from 'zod'
import { verifyJwt } from '@/lib/jwt'

export const authStratum = stratum({
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
    const header = req.headers.get('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null

    if (!token) throw new StratumError(401, 'Missing authorization header')

    const payload = await verifyJwt(token)
    if (!payload) throw new StratumError(401, 'Invalid or expired token')

    return { user: payload }
  },
})
```

---

### Rate limiting stratum

```typescript
// strata/rate-limit.ts
import { stratum, StratumError } from 'strata'
import { z } from 'zod'
import { authStratum } from './auth'
import { redis } from '@/lib/redis'

export const rateLimitStratum = stratum({
  name: 'rateLimit',
  provides: z.object({
    remaining: z.number(),
    resetAt: z.number(),
  }),
  requires: [authStratum],
  resolve: async ({ context }) => {
    const key = `rate:${context.auth.user.id}`
    const window = 60          // 60-second window
    const limit = 100          // 100 requests per window

    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, window)
    const ttl = await redis.ttl(key)

    const remaining = Math.max(0, limit - count)
    const resetAt = Date.now() + ttl * 1000

    if (remaining === 0) {
      throw new StratumError(429, 'Too many requests', {
        error: 'rate_limit_exceeded',
        remaining: 0,
        resetAt,
      })
    }

    return { remaining, resetAt }
  },
})
```

---

### Role-based permissions

A factory function that creates permission strata for any required role:

```typescript
// strata/permission.ts
import { stratum, StratumError } from 'strata'
import { z } from 'zod'
import { authStratum } from './auth'

const roleRank = { admin: 2, user: 1, guest: 0 } as const

export function requireRole(role: 'admin' | 'user') {
  return stratum({
    name: 'permission',
    provides: z.object({ granted: z.literal(true) }),
    requires: [authStratum],
    resolve: async ({ context }) => {
      const userRank = roleRank[context.auth.user.role] ?? 0
      if (userRank < roleRank[role]) {
        throw new StratumError(403, `This action requires the '${role}' role`)
      }
      return { granted: true as const }
    },
  })
}

// Usage
export const DELETE = route({
  strata: [...apiFormation, requireRole('admin')],
  handler: async ({ context }) => { ... },
})
```

---

### Request body validation

```typescript
// strata/body.ts
import { stratum, StratumError } from 'strata'
import { z } from 'zod'

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return stratum({
    name: 'body',
    provides: z.object({ data: schema }),
    requires: [],
    resolve: async ({ req }) => {
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        throw new StratumError(400, 'Request body must be valid JSON')
      }
      const result = schema.safeParse(raw)
      if (!result.success) {
        throw new StratumError(422, 'Validation failed', {
          error: 'validation_error',
          issues: result.error.issues,
        })
      }
      return { data: result.data as z.infer<T> }
    },
  })
}

// Usage
const createPostBody = validateBody(z.object({
  title: z.string().min(1),
  content: z.string().min(1),
}))

export const POST = route({
  strata: [...apiFormation, createPostBody],
  handler: async ({ context }) => {
    // context.body.data is typed as { title: string, content: string }
    const post = await db.post.create({ data: context.body.data })
    return Response.json({ post }, { status: 201 })
  },
})
```

---

## Reusable formations

Formations let you define your common strata combinations once. Think of them as middleware groups with a name.

```typescript
// strata/formations.ts
import { formation } from 'strata'
import { loggingStratum } from './logging'
import { authStratum } from './auth'
import { rateLimitStratum } from './rate-limit'

// Public routes — just logging
export const publicFormation = formation([loggingStratum])

// Authenticated routes — logging + auth + rate limiting
export const apiFormation = formation([loggingStratum, authStratum, rateLimitStratum])

// Admin routes — same as api, plus permission check
export const adminFormation = formation([
  ...apiFormation,
  requireRole('admin'),
])
```

```typescript
// app/api/posts/route.ts
import { apiFormation, adminFormation } from '@/strata/formations'

export const GET = route({
  strata: apiFormation,
  handler: async ({ context }) => { ... },
})

export const DELETE = route({
  strata: adminFormation,
  handler: async ({ context }) => { ... },
})
```

---

## Using with Next.js App Router

Strata is designed for the App Router. The `route()` return value matches Next.js's expected `(req: Request) => Promise<Response>` signature exactly.

```
your-next-app/
├── app/
│   └── api/
│       ├── posts/
│       │   └── route.ts     ← uses apiFormation
│       └── admin/
│           └── route.ts     ← uses adminFormation
└── strata/
    ├── logging.ts
    ├── auth.ts
    ├── rate-limit.ts
    ├── permission.ts
    └── formations.ts
```

```typescript
// app/api/posts/route.ts
import { route } from 'strata'
import { apiFormation } from '@/strata/formations'
import { db } from '@/lib/db'

export const GET = route({
  strata: apiFormation,
  handler: async ({ req, context }) => {
    const { searchParams } = new URL(req.url)
    const page = Number(searchParams.get('page') ?? '1')

    const posts = await db.post.findMany({
      where: { authorId: context.auth.user.id },
      skip: (page - 1) * 10,
      take: 10,
    })

    return Response.json({
      posts,
      requestId: context.logging.requestId,
    })
  },
})
```

No `middleware.ts` required. Auth, logging, and rate limiting live next to the routes they protect.

---

## Using with Cloudflare Workers / Hono

Strata uses only web-standard `Request` and `Response` — it works in any runtime.

```typescript
// Cloudflare Worker
import { route } from 'strata'
import { apiFormation } from './strata/formations'

const GET = route({
  strata: apiFormation,
  handler: async ({ context }) => Response.json({ user: context.auth.user }),
})

export default {
  fetch: (req: Request) => GET(req),
}
```

```typescript
// Hono
import { Hono } from 'hono'
import { route } from 'strata'
import { apiFormation } from './strata/formations'

const app = new Hono()
const getPosts = route({ strata: apiFormation, handler: ... })

app.get('/posts', (c) => getPosts(c.req.raw))
```

---

## TypeScript types

Strata exports all its types for advanced use cases.

```typescript
import type {
  StratumDef,        // the shape of a stratum definition
  AnyStratumDef,     // StratumDef with erased generics
  DepsContext,       // maps a deps tuple to a typed context object
  RouteContext,      // same as DepsContext but for route strata
  ResolveArgs,       // args passed to stratum.resolve()
  HandlerArgs,       // args passed to route.handler()
  ExecutionTrace,    // output of executeStrataWithTrace
  ExecutionWave,     // a single parallel wave in a trace
} from 'strata'
```

### `DepsContext<Deps>`

Given a tuple of strata, produces the merged typed context:

```typescript
type MyContext = DepsContext<[typeof authStratum, typeof loggingStratum]>
// → { auth: { user: { id: string, ... } }, logging: { requestId: string, ... } }
```

### `HandlerArgs<Strata>`

The full argument type for a route handler:

```typescript
async function myHandler({ req, context }: HandlerArgs<typeof apiFormation>) {
  context.auth.user.id   // string ✓
}
```

---

## Development and debugging

### `route.traced()` — execution timing

During development, swap `route()` for `route.traced()`. Every response will include an `X-Strata-Trace` header:

```json
{
  "totalMs": 63,
  "waves": [
    { "parallel": ["logging", "auth"], "ms": 48 },
    { "parallel": ["rateLimit"],       "ms": 15 }
  ]
}
```

This tells you exactly which strata ran in parallel, which had to wait, and how long each wave took. If you see a stratum running alone that could be parallel, check its `requires` — it may have an unnecessary dependency.

### Cycle detection

If you accidentally create a circular dependency, Strata throws at request time (before any I/O):

```
Error: Strata: circular dependency detected at "session".
       Cycle path: auth → session → auth
```

### Naming collisions

Each stratum name must be unique within a route. If two strata have the same `name`, the second one silently overwrites the first in context. Name strata clearly and consistently — treat the name as a key.

---

## Roadmap

- [ ] **npm publish** — available as `strata` on the npm registry
- [ ] **Visual devtools panel** — browser extension / overlay that renders the execution graph with live timing from `X-Strata-Trace`
- [ ] **Express adapter** — `expressRoute()` wrapper for Express 4/5 apps
- [ ] **Next.js scaffold** — `create-strata-app` or `npx strata init` to bootstrap a Next.js project with formation folders and example strata
- [ ] **Strata cache** — per-request memoization so the same stratum used in multiple routes isn't re-executed for the same request
- [ ] **`onError` hook** — per-stratum error handler for logging or fallback behavior
- [ ] **Stream support** — strata that produce streaming responses

---

## Contributing

Contributions are welcome.

```bash
git clone https://github.com/ransjnr/strata
cd strata
npm install
npm test          # run tests with vitest
npm run typecheck # verify TypeScript
npm run build     # build CJS + ESM + .d.ts
```

The core logic lives in four files:

| File | What it does |
|---|---|
| `src/stratum.ts` | `stratum()` factory |
| `src/executor.ts` | dependency collection, cycle detection, parallel wave executor |
| `src/route.ts` | `route()`, `route.traced()`, `formation()` |
| `src/error.ts` | `StratumError` class |

---

## License

MIT — see [LICENSE](./LICENSE)

---

*Built with the belief that declaring what you need is always better than prescribing the order things run.*
