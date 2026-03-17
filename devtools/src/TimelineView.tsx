import type { StratumNode, StrataTrace } from './types'

const WAVE_ACCENT = ['#46E3B7', '#4C9EEB', '#9B6DFF', '#F5A623', '#E55353', '#F472B6']

interface Props {
  nodes: StratumNode[]
  trace: StrataTrace
}

export function TimelineView({ nodes, trace }: Props) {
  const total = trace.totalMs || 1
  const rowH = 40
  const labelW = 140
  const barAreaW = 520
  const svgH = nodes.length * rowH + 56

  return (
    <div className="timeline-wrap">
      <svg width={labelW + barAreaW + 32} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          {WAVE_ACCENT.map((color, i) => (
            <linearGradient key={i} id={`bar-grad-${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.7" />
            </linearGradient>
          ))}
        </defs>

        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const x = labelW + (pct / 100) * barAreaW
          const ms = Math.round((pct / 100) * total)
          return (
            <g key={pct}>
              <line x1={x} y1={0} x2={x} y2={svgH - 28}
                stroke="#1D2B45" strokeWidth={1} strokeDasharray={pct === 0 ? 'none' : '4,4'} />
              <text x={x} y={svgH - 8} textAnchor="middle" fontSize={10}
                fill="#3D5070" fontFamily="'JetBrains Mono', monospace">
                {ms}ms
              </text>
            </g>
          )
        })}

        {/* Rows */}
        {nodes.map((node, i) => {
          const y = i * rowH
          const barX = labelW + (node.startMs / total) * barAreaW
          const barW = Math.max(6, ((node.endMs - node.startMs) / total) * barAreaW)
          const color = WAVE_ACCENT[node.waveIndex % WAVE_ACCENT.length] ?? '#46E3B7'
          const gradId = `bar-grad-${node.waveIndex % WAVE_ACCENT.length}`
          const durationMs = Math.round(node.endMs - node.startMs)

          return (
            <g key={node.name}>
              {/* Row bg */}
              <rect x={0} y={y + 2} width={labelW + barAreaW + 32} height={rowH - 4}
                fill={i % 2 === 0 ? '#0D1221' : '#111827'} rx={6} />

              {/* Wave dot */}
              <circle cx={14} cy={y + rowH / 2} r={5}
                fill={color} opacity={0.9} />

              {/* Stratum name */}
              <text x={labelW - 12} y={y + rowH / 2 + 5} textAnchor="end"
                fontSize={12} fill="#A8B5CC"
                fontFamily="'JetBrains Mono', monospace">
                {node.name}
              </text>

              {/* Bar */}
              <rect x={barX} y={y + 10} width={barW} height={rowH - 20}
                rx={5} fill={`url(#${gradId})`} />

              {/* Duration chip */}
              {barW > 44 ? (
                <text x={barX + barW / 2} y={y + rowH / 2 + 4} textAnchor="middle"
                  fontSize={10} fill="#0B0F19" fontWeight="600"
                  fontFamily="'JetBrains Mono', monospace">
                  {durationMs}ms
                </text>
              ) : (
                <text x={barX + barW + 6} y={y + rowH / 2 + 4} textAnchor="start"
                  fontSize={10} fill={color}
                  fontFamily="'JetBrains Mono', monospace">
                  {durationMs}ms
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
