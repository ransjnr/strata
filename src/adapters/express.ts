/**
 * Strata — Express adapter
 *
 * Bridges Strata's web-standard Request/Response API to Express 4/5.
 *
 * Usage:
 *   import { expressRoute } from '@ransjnr/strata/express'
 *
 *   app.get('/posts', expressRoute({
 *     strata: [loggingStratum, authStratum],
 *     handler: async ({ context }) => Response.json({ user: context.auth.user }),
 *   }))
 */

import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction, RequestHandler } from 'express'
import { route } from '../route.js'
import type { AnyStratumDef, RouteDef } from '../types.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Copy a Node.js Buffer into a plain ArrayBuffer (avoids ArrayBufferLike TS issues). */
function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.length)
  new Uint8Array(ab).set(buf)
  return ab
}

// ─── Request bridge: Express → Web ───────────────────────────────────────────

/**
 * Converts an Express request into a web-standard Request.
 *
 * Handles two body cases:
 *  1. Body-parser has already run → req.body is set; re-serialize to BodyInit.
 *  2. No body-parser → read the raw Node.js stream into a Buffer.
 */
async function toWebRequest(req: ExpressRequest): Promise<Request> {
  // Build a full URL from Express's parts
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol ?? 'http'
  const host = req.headers.host ?? 'localhost'
  const url = `${proto}://${host}${req.originalUrl}`

  // Copy all incoming headers into a Web Headers object
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }

  // Build the body
  let body: BodyInit | null = null
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body !== undefined) {
      // body-parser ran — re-materialize
      if (Buffer.isBuffer(req.body)) {
        body = new Blob([bufferToArrayBuffer(req.body)])
      } else if (typeof req.body === 'string') {
        body = req.body
      } else if (typeof req.body === 'object' && req.body !== null) {
        body = JSON.stringify(req.body)
        // Ensure content-type is set so strata can call req.json()
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json')
        }
      }
    } else {
      // No body-parser — drain the Node.js stream
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => resolve(Buffer.concat(chunks)))
        req.on('error', reject)
      })
      body = new Blob([bufferToArrayBuffer(raw)])
    }
  }

  return new Request(url, { method: req.method, headers, body })
}

// ─── Response bridge: Web → Express ──────────────────────────────────────────

/**
 * Sends a web-standard Response via an Express res object.
 * Buffers the body — suitable for JSON/text API responses.
 */
async function sendWebResponse(webRes: Response, res: ExpressResponse): Promise<void> {
  res.status(webRes.status)

  webRes.headers.forEach((value, key) => {
    // Express sets Content-Type automatically via res.send/json;
    // we set headers directly to preserve whatever Strata produced.
    res.setHeader(key, value)
  })

  const buffer = Buffer.from(await webRes.arrayBuffer())
  res.end(buffer)
}

// ─── expressRoute() ──────────────────────────────────────────────────────────

/**
 * Wraps a Strata route definition into an Express RequestHandler.
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { expressRoute } from '@ransjnr/strata/express'
 * import { apiFormation } from './strata/formations'
 *
 * const app = express()
 * app.use(express.json())
 *
 * app.get('/posts', expressRoute({
 *   strata: apiFormation,
 *   handler: async ({ context }) =>
 *     Response.json({ user: context.auth.user }),
 * }))
 * ```
 */
export function expressRoute<const Strata extends readonly AnyStratumDef[]>(
  def: RouteDef<Strata>,
): RequestHandler {
  const handler = route(def)

  return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const webReq = await toWebRequest(req)
      const webRes = await handler(webReq)
      await sendWebResponse(webRes, res)
    } catch (err) {
      // Pass unexpected errors to Express's error handler
      next(err)
    }
  }
}

// ─── expressRoute.traced() ────────────────────────────────────────────────────

/**
 * Like `expressRoute()` but attaches an `X-Strata-Trace` header with
 * execution timing. Use in development to inspect parallel execution.
 *
 * @example
 * ```ts
 * app.get('/posts', expressRoute.traced({
 *   strata: apiFormation,
 *   handler: async ({ context }) => Response.json({ ok: true }),
 * }))
 * // Response will include:
 * // X-Strata-Trace: {"totalMs":63,"waves":[{"parallel":["logging","auth"],"ms":48},...]}
 * ```
 */
expressRoute.traced = function expressRouteTraced<
  const Strata extends readonly AnyStratumDef[],
>(def: RouteDef<Strata>): RequestHandler {
  const handler = route.traced(def)

  return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const webReq = await toWebRequest(req)
      const webRes = await handler(webReq)
      await sendWebResponse(webRes, res)
    } catch (err) {
      next(err)
    }
  }
}
