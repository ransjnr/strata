import { useState } from 'react'
import { WaterfallChart } from './WaterfallChart'
import { WaveGraph } from './WaveGraph'
import { parseTrace, DEMO_TRACES } from './parseTrace'
import type { StrataTrace } from './types'
import './App.css'

type Tab = 'waterfall' | 'graph' | 'paste'

export default function App() {
  const [selectedDemo, setSelectedDemo] = useState(0)
  const [tab, setTab] = useState<Tab>('waterfall')
  const [pasteValue, setPasteValue] = useState('')
  const [pasteError, setPasteError] = useState('')
  const [customTrace, setCustomTrace] = useState<StrataTrace | null>(null)

  const activeTrace: StrataTrace = customTrace ?? DEMO_TRACES[selectedDemo]!.trace
  const nodes = parseTrace(activeTrace)

  const savedMs = activeTrace.waves.reduce(
    (sum, w) => sum + w.ms * (w.parallel.length - 1), 0
  )

  function handlePaste(raw: string) {
    setPasteValue(raw)
    setPasteError('')
    setCustomTrace(null)
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw) as StrataTrace
      if (!Array.isArray(parsed.waves)) throw new Error('Missing waves array')
      setCustomTrace(parsed)
    } catch (e) {
      setPasteError((e as Error).message)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-icon">◈</span>
          <span className="logo-name">Strata DevTools</span>
          <span className="logo-version">v0.2.0</span>
        </div>
        <p className="header-sub">
          Visualize your pipeline — paste an <code>X-Strata-Trace</code> header or explore the demos.
        </p>
      </header>

      <section className="demo-bar">
        <span className="demo-label">Demos:</span>
        {DEMO_TRACES.map((d, i) => (
          <button
            key={i}
            className={`demo-btn ${selectedDemo === i && !customTrace ? 'active' : ''}`}
            onClick={() => { setSelectedDemo(i); setCustomTrace(null) }}
          >
            {d.label}
          </button>
        ))}
      </section>

      <section className="summary-bar">
        <div className="summary-stat">
          <span className="stat-value">{Math.round(activeTrace.totalMs)}ms</span>
          <span className="stat-label">total</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <span className="stat-value">{activeTrace.waves.length}</span>
          <span className="stat-label">waves</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <span className="stat-value">{nodes.length}</span>
          <span className="stat-label">strata</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <span className="stat-value">
            {activeTrace.waves.filter(w => w.parallel.length > 1).length}
          </span>
          <span className="stat-label">parallel waves</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <span className="stat-value savings">{Math.round(savedMs)}ms saved</span>
          <span className="stat-label">vs sequential</span>
        </div>
      </section>

      <div className="tabs">
        {(['waterfall', 'graph', 'paste'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}>
            {t === 'waterfall' ? '⏱ Waterfall' : t === 'graph' ? '◈ Graph' : '⌨ Paste Header'}
          </button>
        ))}
      </div>

      <div className="panel">
        {tab === 'waterfall' && (
          <div className="chart-wrap">
            <p className="chart-hint">Each row is a stratum. Rows sharing the same wave colour ran in parallel.</p>
            <WaterfallChart nodes={nodes} trace={activeTrace} />
          </div>
        )}
        {tab === 'graph' && (
          <div className="chart-wrap">
            <p className="chart-hint">Each column is a wave. Nodes in the same column ran in parallel.</p>
            <WaveGraph trace={activeTrace} />
          </div>
        )}
        {tab === 'paste' && (
          <div className="paste-wrap">
            <p className="chart-hint">
              Copy the value of the <code>X-Strata-Trace</code> response header
              from <code>route.traced()</code> or <code>expressRoute.traced()</code> and paste it here.
            </p>
            <textarea
              className={`paste-input ${pasteError ? 'error' : ''}`}
              placeholder={'{"totalMs":73,"waves":[{"parallel":["logging","auth"],"ms":48},{"parallel":["rateLimit"],"ms":15}]}'}
              value={pasteValue}
              onChange={(e) => handlePaste(e.target.value)}
              rows={6}
            />
            {pasteError && <p className="paste-error">⚠ {pasteError}</p>}
            {customTrace && (
              <p className="paste-ok">✓ Parsed — switch to Waterfall or Graph to visualize.</p>
            )}
          </div>
        )}
      </div>

      <section className="legend">
        {activeTrace.waves.map((wave, i) => {
          const colors = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ec4899','#8b5cf6']
          const color = colors[i % colors.length]!
          return (
            <div key={i} className="legend-item">
              <span className="legend-dot" style={{ background: color }} />
              <span className="legend-text">
                Wave {i + 1}: [{wave.parallel.join(', ')}] — {Math.round(wave.ms)}ms
                {wave.parallel.length > 1 && <span className="legend-parallel"> · parallel</span>}
              </span>
            </div>
          )
        })}
      </section>
    </div>
  )
}
