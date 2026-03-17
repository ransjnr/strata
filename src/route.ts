import { isStratumError, StratumError } from './error.js'
import { executeStrata, executeStrataWithTrace } from './executor.js'
import type { AnyStratumDef, HandlerArgs, RouteContext, RouteDef } from './types.js'

// ─── route() ────────────────────────────────────────────────────────────────

/**
 * Compose strata into a route handler.
 *
 * Returns a standard `(req: Request) => Promise<Response>` function — works
 * directly in Next.js App Router, Cloudflare Workers, Hono, etc.
 *
 * @example
 * ```ts
 * // app/api/user/route.ts
 * export const GET = route({
 *   strata: [loggingStratum, authStratum, rateLimitStratum],
 *   handler: async ({ req, context }) => {
 *     // context is fully typed:
 *     // { logging: { requestId: string }, auth: { user: ... }, rateLimit: { remaining: number } }
 *     return Response.json({ userId: context.auth.user.id })
 *   },
 * })
 * ```
 */
export function route<const Strata extends readonly AnyStratumDef[]>(
  def: RouteDef<Strata>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const context = await executeStrata(def.strata, req)
      return await def.handler({
        req,
        context: context as RouteContext<Strata>,
      })
    } catch (err) {
      if (isStratumError(err)) {
        return err.toResponse()
      }
      // Unhandled errors become 500
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      return new StratumError(500, message).toResponse()
    }
  }
}

// ─── route.traced() ─────────────────────────────────────────────────────────

/**
 * Like `route()` but attaches an `X-Strata-Trace` header with execution info.
 * Useful in development to see which strata ran in parallel and how long each
 * wave took.
 */
route.traced = function routeTraced<
  const Strata extends readonly AnyStratumDef[],
>(def: RouteDef<Strata>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const { context, waves, totalMs } = await executeStrataWithTrace(
        def.strata,
        req,
      )
      const response = await def.handler({
        req,
        context: context as RouteContext<Strata>,
      })

      // Clone to add headers (Response is immutable)
      const traced = new Response(response.body, response)
      traced.headers.set(
        'X-Strata-Trace',
        JSON.stringify({
          totalMs: Math.round(totalMs),
          waves: waves.map((w) => ({
            parallel: w.parallel,
            ms: Math.round(w.durationMs),
          })),
        }),
      )
      return traced
    } catch (err) {
      if (isStratumError(err)) {
        return err.toResponse()
      }
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      return new StratumError(500, message).toResponse()
    }
  }
}

// ─── formation() ─────────────────────────────────────────────────────────────

/**
 * Bundle a set of strata into a reusable "formation" that can be spread into
 * any route's `strata` array.
 *
 * @example
 * ```ts
 * export const apiFormation = formation([loggingStratum, authStratum, rateLimitStratum])
 *
 * export const GET = route({
 *   strata: apiFormation,
 *   handler: async ({ context }) => { ... },
 * })
 * ```
 */
export function formation<const Strata extends readonly AnyStratumDef[]>(
  strata: Strata,
): Strata {
  return strata
}

// ─── HandlerArgs re-export for convenience ───────────────────────────────────
export type { HandlerArgs }
