import type { AnyStratumDef, ExecutorStratum, ResolvedContext } from './types.js'

// ─── Dependency collection ───────────────────────────────────────────────────

/**
 * Walk the dependency tree of the given strata and return a deduplicated flat
 * list that includes all transitive requirements, in insertion order.
 */
export function collectAllStrata(
  strata: readonly AnyStratumDef[],
): ExecutorStratum[] {
  const seen = new Map<string, ExecutorStratum>()

  function visit(s: AnyStratumDef): void {
    if (seen.has(s.name)) return
    // Visit deps first so they appear earlier in the map
    for (const dep of s.requires) {
      visit(dep as AnyStratumDef)
    }
    seen.set(s.name, s as unknown as ExecutorStratum)
  }

  for (const s of strata) {
    visit(s)
  }

  return [...seen.values()]
}

// ─── Cycle detection ─────────────────────────────────────────────────────────

export function assertNoCycles(strata: ExecutorStratum[]): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function dfs(s: ExecutorStratum): void {
    if (visited.has(s.name)) return
    if (visiting.has(s.name)) {
      throw new Error(
        `Strata: circular dependency detected at "${s.name}". ` +
          `Cycle path: ${[...visiting].join(' → ')} → ${s.name}`,
      )
    }
    visiting.add(s.name)
    for (const dep of s.requires) {
      dfs(dep)
    }
    visiting.delete(s.name)
    visited.add(s.name)
  }

  for (const s of strata) {
    dfs(s)
  }
}

// ─── Parallel wave executor ──────────────────────────────────────────────────

/**
 * Execute strata in topological order, running independent strata in parallel.
 *
 * Algorithm:
 *  1. Collect all strata (including transitive deps).
 *  2. Repeatedly find "ready" strata — those whose deps are all resolved.
 *  3. Execute each ready batch with Promise.all (true parallelism).
 *  4. Repeat until all strata are resolved.
 *
 * Returns the accumulated context (name → output) for all strata.
 */
export async function executeStrata(
  strata: readonly AnyStratumDef[],
  req: Request,
): Promise<ResolvedContext> {
  const all = collectAllStrata(strata)
  assertNoCycles(all)

  const context: ResolvedContext = {}
  const resolved = new Set<string>()

  while (resolved.size < all.length) {
    // Find all strata whose dependencies are already in context
    const ready = all.filter(
      (s) =>
        !resolved.has(s.name) &&
        s.requires.every((dep) => resolved.has(dep.name)),
    )

    if (ready.length === 0) {
      // Should not happen after cycle detection, but guard anyway
      const pending = all
        .filter((s) => !resolved.has(s.name))
        .map((s) => s.name)
        .join(', ')
      throw new Error(
        `Strata: deadlock — cannot resolve remaining strata: [${pending}]`,
      )
    }

    // Run all ready strata in parallel
    const results = await Promise.all(
      ready.map(async (s) => {
        const output = await s.resolve({ req, context })
        return [s.name, output] as const
      }),
    )

    for (const [name, output] of results) {
      context[name] = output
      resolved.add(name)
    }
  }

  return context
}

// ─── Execution trace (dev tooling) ──────────────────────────────────────────

export interface ExecutionWave {
  parallel: string[]
  durationMs: number
}

export interface ExecutionTrace {
  totalMs: number
  waves: ExecutionWave[]
  context: ResolvedContext
}

/**
 * Same as `executeStrata` but returns a full execution trace — useful for
 * debugging and the future dev-tools visualizer.
 */
export async function executeStrataWithTrace(
  strata: readonly AnyStratumDef[],
  req: Request,
): Promise<ExecutionTrace> {
  const all = collectAllStrata(strata)
  assertNoCycles(all)

  const context: ResolvedContext = {}
  const resolved = new Set<string>()
  const waves: ExecutionWave[] = []
  const totalStart = performance.now()

  while (resolved.size < all.length) {
    const ready = all.filter(
      (s) =>
        !resolved.has(s.name) &&
        s.requires.every((dep) => resolved.has(dep.name)),
    )

    if (ready.length === 0) {
      const pending = all
        .filter((s) => !resolved.has(s.name))
        .map((s) => s.name)
        .join(', ')
      throw new Error(
        `Strata: deadlock — cannot resolve remaining strata: [${pending}]`,
      )
    }

    const waveStart = performance.now()
    const results = await Promise.all(
      ready.map(async (s) => {
        const output = await s.resolve({ req, context })
        return [s.name, output] as const
      }),
    )

    for (const [name, output] of results) {
      context[name] = output
      resolved.add(name)
    }

    waves.push({
      parallel: ready.map((s) => s.name),
      durationMs: performance.now() - waveStart,
    })
  }

  return {
    totalMs: performance.now() - totalStart,
    waves,
    context,
  }
}
