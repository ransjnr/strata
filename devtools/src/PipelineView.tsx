import type { StrataTrace } from './types'

const WAVE_ACCENT = ['#46E3B7', '#4C9EEB', '#9B6DFF', '#F5A623', '#E55353', '#F472B6']

interface Props {
  trace: StrataTrace
}

export function PipelineView({ trace }: Props) {
  const total = trace.totalMs || 1

  return (
    <div className="pipeline">
      {trace.waves.map((wave, wi) => {
        const accent = WAVE_ACCENT[wi % WAVE_ACCENT.length]!
        const isParallel = wave.parallel.length > 1
        const pct = Math.round((wave.ms / total) * 100)

        return (
          <div key={wi} className="pipeline-wave-wrap">

            {/* ── Wave card ── */}
            <div className="wave-card" style={{ '--wave-accent': accent } as React.CSSProperties}>

              {/* Wave header */}
              <div className="wave-header">
                <div className="wave-header-left">
                  <span className="wave-number" style={{ color: accent }}>Wave {wi + 1}</span>
                  {isParallel && (
                    <span className="wave-badge">
                      <span className="wave-badge-dot" style={{ background: accent }} />
                      {wave.parallel.length} strata · parallel
                    </span>
                  )}
                </div>
                <div className="wave-header-right">
                  <span className="wave-pct" style={{ color: accent }}>{pct}%</span>
                  <span className="wave-ms">{Math.round(wave.ms)}ms</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="wave-progress-track">
                <div className="wave-progress-bar"
                  style={{ width: `${pct}%`, background: accent }} />
              </div>

              {/* Steps */}
              <div className="wave-steps">
                {wave.parallel.map((name, si) => {
                  const isLast = si === wave.parallel.length - 1
                  return (
                    <div key={name} className="step">
                      {/* Left track */}
                      <div className="step-track">
                        <div className="step-dot" style={{ background: accent, boxShadow: `0 0 0 4px ${accent}22` }}>
                          <CheckIcon />
                        </div>
                        {!isLast && (
                          <div className="step-line"
                            style={{ background: `linear-gradient(to bottom, ${accent}44, ${accent}11)` }} />
                        )}
                      </div>

                      {/* Step content */}
                      <div className="step-body">
                        <span className="step-name">{name}</span>
                        <div className="step-right">
                          <span className="step-tag"
                            style={{ color: accent, background: `${accent}14`, border: `1px solid ${accent}30` }}>
                            success
                          </span>
                          <span className="step-ms">{Math.round(wave.ms)}ms</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Parallel indicator */}
              {isParallel && (
                <div className="parallel-indicator" style={{ borderColor: `${accent}30`, color: accent }}>
                  <ParallelIcon color={accent} />
                  <span>Ran in parallel — saved ~{Math.round(wave.ms * (wave.parallel.length - 1))}ms</span>
                </div>
              )}
            </div>

            {/* ── Connector between waves ── */}
            {wi < trace.waves.length - 1 && (
              <div className="wave-connector">
                <div className="connector-line" />
                <div className="connector-arrow">
                  <ArrowDownIcon />
                </div>
                <div className="connector-label">next wave</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 5l2.5 2.5L8 3" stroke="#0B0F19" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ParallelIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 2v10M7 2v10M11 2v10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 2v8M3 7l3 3 3-3" stroke="#3D5070" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
