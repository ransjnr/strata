import type { AnyStratumDef, AnyZodObject, StratumDef } from './types.js'
import type { z } from 'zod'

/**
 * Define a single pipeline concern.
 *
 * @example
 * ```ts
 * const authStratum = stratum({
 *   name: 'auth',
 *   provides: z.object({ user: z.object({ id: z.string() }) }),
 *   requires: [],
 *   resolve: async ({ req }) => {
 *     const user = await verifyToken(req.headers.get('authorization'))
 *     if (!user) throw new StratumError(401, 'Unauthorized')
 *     return { user }
 *   },
 * })
 * ```
 */
export function stratum<
  const Name extends string,
  const Provides extends AnyZodObject,
  const Deps extends readonly AnyStratumDef[],
>(config: {
  name: Name
  provides: Provides
  requires: Deps
  resolve(args: {
    req: Request
    context: { [D in Deps[number] as D['name']]: z.infer<D['provides']> }
  }): Promise<z.infer<Provides>>
}): StratumDef<Name, Provides, Deps> {
  return config as StratumDef<Name, Provides, Deps>
}
