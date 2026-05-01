import type { z } from 'zod'
import type { AnyZodObject } from './types.js'

/**
 * A tool an agent can call during its tool-use loop.
 *
 * Tools take typed input (validated against `input`) and return any
 * JSON-serializable output. They are NOT request-bound — the same tool can
 * be reused across many agents and many requests.
 */
export interface ToolDef<
  Name extends string = string,
  Input extends AnyZodObject = AnyZodObject,
  Output = unknown,
> {
  readonly name: Name
  readonly description: string
  readonly input: Input
  run(args: { input: z.infer<Input>; signal?: AbortSignal }): Promise<Output>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDef = ToolDef<string, AnyZodObject, any>

/**
 * Define a tool an agent can call.
 *
 * @example
 * ```ts
 * const searchTool = tool({
 *   name: 'search',
 *   description: 'Search the knowledge base for relevant articles.',
 *   input: z.object({ query: z.string() }),
 *   run: async ({ input }) => {
 *     return await db.articles.search(input.query)
 *   },
 * })
 * ```
 */
export function tool<
  const Name extends string,
  const Input extends AnyZodObject,
  Output,
>(config: {
  name: Name
  description: string
  input: Input
  run(args: {
    input: z.infer<Input>
    signal?: AbortSignal
  }): Promise<Output>
}): ToolDef<Name, Input, Output> {
  return config
}
