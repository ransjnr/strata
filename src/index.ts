/**
 * Strata — declarative, type-safe, parallel request pipeline
 *
 * Replace imperative middleware chains with a dependency graph of typed
 * concerns that run in parallel wherever possible.
 *
 * Core API:
 *   stratum()    — define a single pipeline concern
 *   route()      — compose strata into a route handler
 *   formation()  — bundle strata into a reusable group
 *   StratumError — throw to short-circuit with an HTTP error
 */

export { stratum } from './stratum.js'
export { route, formation } from './route.js'
export { StratumError, isStratumError } from './error.js'

// Types
export type {
  StratumDef,
  AnyStratumDef,
  DepsContext,
  RouteContext,
  ResolveArgs,
  HandlerArgs,
  RouteDef,
} from './types.js'

export type { ExecutionTrace, ExecutionWave } from './executor.js'
