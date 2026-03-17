import { useState } from 'react'
import type { StrataTrace } from './types'

interface Props {
  onTrace: (trace: StrataTrace | null) => void
}

export function ImportView({ onTrace }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  function handleChange(raw: string) {
    setValue(raw)
    setError('')
    setOk(false)
    onTrace(null)
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw) as StrataTrace
      if (!Array.isArray(parsed.waves)) throw new Error('Missing "waves" array')
      if (typeof parsed.totalMs !== 'number') throw new Error('Missing "totalMs" number')
      onTrace(parsed)
      setOk(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="import-view">
      <div className="import-header">
        <h2 className="import-title">Import Trace</h2>
        <p className="import-sub">
          Paste the value of the <code>X-Strata-Trace</code> response header from{' '}
          <code>route.traced()</code> or <code>expressRoute.traced()</code>.
        </p>
      </div>

      <div className="import-card">
        <div className="import-card-header">
          <span className="import-card-label">X-Strata-Trace header value</span>
          {value && (
            <button className="import-clear" onClick={() => { setValue(''); setError(''); setOk(false); onTrace(null) }}>
              Clear
            </button>
          )}
        </div>
        <textarea
          className={`import-textarea ${error ? 'has-error' : ok ? 'has-ok' : ''}`}
          placeholder='{"totalMs": 73, "waves": [{"parallel": ["logging", "auth"], "ms": 48}, {"parallel": ["rateLimit"], "ms": 15}]}'
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          rows={8}
          spellCheck={false}
        />
        {error && (
          <div className="import-feedback error">
            <ErrorIcon /> {error}
          </div>
        )}
        {ok && (
          <div className="import-feedback success">
            <CheckCircleIcon /> Trace parsed — switch to Pipeline, Timeline, or Graph to visualize.
          </div>
        )}
      </div>

      <div className="import-example">
        <p className="import-example-label">Example output from <code>route.traced()</code></p>
        <pre className="import-example-code">{`// In your route file:
export const GET = route.traced({
  strata: [loggingStratum, authStratum, rateLimitStratum],
  handler: async ({ context }) => Response.json({ ok: true }),
})

// Response header:
X-Strata-Trace: {"totalMs":63,"waves":[
  {"parallel":["logging","auth"],"ms":48},
  {"parallel":["rateLimit"],"ms":15}
]}`}</pre>
      </div>
    </div>
  )
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="6" stroke="#E55353" strokeWidth="1.5" />
      <path d="M7 4v3M7 9.5v.5" stroke="#E55353" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="6" stroke="#46E3B7" strokeWidth="1.5" />
      <path d="M4.5 7l2 2 3-3.5" stroke="#46E3B7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
