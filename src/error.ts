/**
 * Thrown inside a stratum's `resolve` to short-circuit the pipeline and
 * return an HTTP error response to the caller.
 *
 * Any unhandled Error (not a StratumError) will become a 500.
 */
export class StratumError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(
    status: number,
    message: string,
    /** Optional structured body. Defaults to `{ error: message }`. */
    body?: unknown,
  ) {
    super(message)
    this.name = 'StratumError'
    this.status = status
    this.body = body ?? { error: message }
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.body), {
      status: this.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/** Type guard */
export function isStratumError(err: unknown): err is StratumError {
  return err instanceof StratumError
}
