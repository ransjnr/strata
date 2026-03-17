import { useState } from 'react'
import { PipelineView } from './PipelineView'
import { TimelineView } from './TimelineView'
import { GraphView } from './GraphView'
import { ImportView } from './ImportView'
import { parseTrace, DEMO_TRACES } from './parseTrace'
import type { StrataTrace } from './types'
import './App.css'

type View = 'pipeline' | 'timeline' | 'graph' | 'import'

const WAVE_ACCENT = ['#46E3B7', '#4C9EEB', '#9B6DFF', '#F5A623', '#E55353', '#F472B6']

export default function App() {
  const [view, setView] = useState<View>('pipeline')
  const [selectedDemo, setSelectedDemo] = useState(0)
  const [customTrace, setCustomTrace] = useState<StrataTrace | null>(null)

  const activeTrace = customTrace ?? DEMO_TRACES[selectedDemo]!.trace
  const nodes = parseTrace(activeTrace)
  const savedMs = activeTrace.waves.reduce((s, w) => s + w.ms * (w.parallel.length - 1), 0)
  const parallelWaves = activeTrace.waves.filter(w => w.parallel.length > 1).length

  return (
    <div className="shell">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">◈</div>
          <div>
            <div className="sidebar-logo-name">Strata</div>
            <div className="sidebar-logo-sub">DevTools</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav-section">Execution</div>
          <NavItem id="pipeline" active={view} icon={<PipelineIcon />} label="Pipeline" onClick={setView} />
          <NavItem id="timeline" active={view} icon={<TimelineIcon />} label="Timeline" onClick={setView} />
          <NavItem id="graph" active={view} icon={<GraphIcon />} label="Graph" onClick={setView} />
        </nav>

        <div className="sidebar-divider" />

        <nav className="sidebar-nav">
          <div className="sidebar-nav-section">Trace</div>
          <NavItem id="import" active={view} icon={<ImportIcon />} label="Import Header" onClick={setView} />
        </nav>

        <div className="sidebar-footer">
          <a className="sidebar-footer-link" href="https://github.com/ransjnr/strata" target="_blank" rel="noreferrer">
            <GitHubIcon />
            <span>ransjnr/strata</span>
          </a>
          <div className="sidebar-version">v0.2.0</div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="main">

        {/* Topbar */}
        <div className="topbar">
          <div className="topbar-left">
            <div className="topbar-breadcrumb">
              <span className="topbar-breadcrumb-dim">strata</span>
              <span className="topbar-breadcrumb-sep">/</span>
              <span className="topbar-breadcrumb-page">{view}</span>
            </div>
            {/* Demo selector */}
            <div className="trace-selector">
              {DEMO_TRACES.map((d, i) => (
                <button
                  key={i}
                  className={`trace-btn ${selectedDemo === i && !customTrace ? 'active' : ''}`}
                  onClick={() => { setSelectedDemo(i); setCustomTrace(null) }}
                >
                  <span className="trace-btn-method"
                    style={{ color: WAVE_ACCENT[i % WAVE_ACCENT.length] }}>
                    {d.label.split(' ')[0]}
                  </span>
                  <span className="trace-btn-path">
                    {d.label.split(' ').slice(1).join(' ')}
                  </span>
                </button>
              ))}
              {customTrace && (
                <div className="trace-custom-badge">
                  <span className="trace-btn-method" style={{ color: '#46E3B7' }}>CUSTOM</span>
                  <span className="trace-btn-path">imported trace</span>
                </div>
              )}
            </div>
          </div>

          {/* Stat chips */}
          <div className="topbar-stats">
            <StatChip label="Total" value={`${Math.round(activeTrace.totalMs)}ms`} color="#E8EDF5" />
            <StatChip label="Waves" value={String(activeTrace.waves.length)} color="#4C9EEB" />
            <StatChip label="Strata" value={String(nodes.length)} color="#9B6DFF" />
            <StatChip label="Parallel" value={String(parallelWaves)} color="#F5A623" />
            <StatChip label="Saved" value={`${Math.round(savedMs)}ms`} color="#46E3B7" highlight />
          </div>
        </div>

        {/* Content */}
        <div className="content">
          <div className="content-inner">
            {view === 'pipeline'  && <PipelineView trace={activeTrace} />}
            {view === 'timeline'  && <TimelineView nodes={nodes} trace={activeTrace} />}
            {view === 'graph'     && <GraphView trace={activeTrace} />}
            {view === 'import'    && <ImportView onTrace={setCustomTrace} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NavItem({ id, active, icon, label, onClick }: {
  id: View; active: View; icon: React.ReactNode; label: string; onClick: (v: View) => void
}) {
  return (
    <button className={`nav-item ${active === id ? 'active' : ''}`} onClick={() => onClick(id)}>
      <span className="nav-item-icon">{icon}</span>
      <span className="nav-item-label">{label}</span>
      {active === id && <span className="nav-item-indicator" />}
    </button>
  )
}

function StatChip({ label, value, color, highlight }: {
  label: string; value: string; color: string; highlight?: boolean
}) {
  return (
    <div className={`stat-chip ${highlight ? 'stat-chip-highlight' : ''}`}
      style={highlight ? { borderColor: `${color}40`, background: `${color}0d` } : {}}>
      <span className="stat-chip-value" style={{ color }}>{value}</span>
      <span className="stat-chip-label">{label}</span>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function PipelineIcon() {
  return <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="1" y="2" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <rect x="9" y="2" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <rect x="5" y="9" width="5" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M3.5 7v2h8V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
function TimelineIcon() {
  return <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M2 4h11M2 7.5h7M2 11h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
}
function GraphIcon() {
  return <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <circle cx="3" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12" cy="3" r="2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5 7l5-3M5 8l5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
}
function ImportIcon() {
  return <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M7.5 2v8M5 8l2.5 2.5L10 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 11v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
}
function GitHubIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M7 0C3.13 0 0 3.13 0 7c0 3.09 2.01 5.72 4.79 6.65.35.06.48-.15.48-.34v-1.2c-1.95.42-2.36-.94-2.36-.94-.32-.81-.78-1.02-.78-1.02-.64-.44.05-.43.05-.43.7.05 1.07.72 1.07.72.62 1.07 1.63.76 2.03.58.06-.45.24-.76.44-.93-1.55-.18-3.19-.78-3.19-3.46 0-.76.27-1.39.72-1.87-.07-.18-.31-.89.07-1.85 0 0 .59-.19 1.92.72A6.7 6.7 0 017 3.54c.59 0 1.19.08 1.74.23 1.34-.9 1.92-.72 1.92-.72.38.96.14 1.67.07 1.85.45.49.72 1.11.72 1.87 0 2.69-1.64 3.28-3.2 3.45.25.22.48.64.48 1.3v1.92c0 .19.13.4.48.34C11.99 12.72 14 10.09 14 7c0-3.87-3.13-7-7-7z" />
  </svg>
}
