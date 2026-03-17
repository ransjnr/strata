import type { z } from 'zod'

// ─── Zod helpers ────────────────────────────────────────────────────────────

export type AnyZodObject = z.ZodObject<z.ZodRawShape>

// ─── Core stratum shape ──────────────────────────────────────────────────────

/**
 * A single concern in a Strata pipeline.
 *
 * Each stratum:
 *  - declares what it `provides` (a Zod schema → typed output)
 *  - declares what it `requires` (other strata it depends on)
 *  - implements `resolve` to produce its output given the request + deps context
 */
export interface StratumDef<
  Name extends string,
  Provides extends AnyZodObject,
  Deps extends readonly AnyStratumDef[],
> {
  readonly name: Name
  readonly provides: Provides
  readonly requires: Deps
  resolve(args: ResolveArgs<Deps>): Promise<z.infer<Provides>>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStratumDef = StratumDef<string, AnyZodObject, readonly any[]>

// ─── Context inference ───────────────────────────────────────────────────────

/**
 * Given a tuple of strata, produces a typed context object keyed by name.
 *
 * e.g. [AuthStratum, LoggingStratum] →
 *   { auth: { user: ... }, logging: { requestId: string } }
 */
export type DepsContext<Deps extends readonly AnyStratumDef[]> = {
  [D in Deps[number] as D['name']]: z.infer<D['provides']>
}

/**
 * Full context exposed to a route handler — same shape as DepsContext
 * but accepts any list of strata.
 */
export type RouteContext<Strata extends readonly AnyStratumDef[]> =
  DepsContext<Strata>

// ─── Resolve args ────────────────────────────────────────────────────────────

export interface ResolveArgs<Deps extends readonly AnyStratumDef[]> {
  /** The incoming web-standard Request */
  req: Request
  /** Fully typed context from all declared dependencies */
  context: DepsContext<Deps>
}

// ─── Handler args ────────────────────────────────────────────────────────────

export interface HandlerArgs<Strata extends readonly AnyStratumDef[]> {
  req: Request
  context: RouteContext<Strata>
}

// ─── Route definition ────────────────────────────────────────────────────────

export interface RouteDef<Strata extends readonly AnyStratumDef[]> {
  strata: Strata
  handler(args: HandlerArgs<Strata>): Promise<Response>
}

// ─── Internal executor types ─────────────────────────────────────────────────

/** Flat map of resolved stratum outputs, used internally by the executor */
export type ResolvedContext = Record<string, unknown>

/** A stratum as seen by the executor (erased generics) */
export interface ExecutorStratum {
  name: string
  requires: readonly ExecutorStratum[]
  resolve(args: { req: Request; context: ResolvedContext }): Promise<unknown>
}
