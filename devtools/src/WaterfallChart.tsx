import type { StratumNode, StrataTrace } from './types'

const WAVE_COLORS = [
  '#6366f1', // indigo
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
]

interface Props {
  nodes: StratumNode[]
  trace: StrataTrace
}

export function WaterfallChart({ nodes, trace }: Props) {
  const total = trace.totalMs || 1
  const rowH = 36
  const labelW = 130
  const barAreaW = 520
  const height = nodes.length * rowH + 48

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={labelW + barAreaW + 40} height={height} style={{ display: 'block' }}>
        {/* Time axis ticks */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const x = labelW + (pct / 100) * barAreaW
          const ms = Math.round((pct / 100) * total)
          return (
            <g key={pct}>
              <line x1={x} y1={0} x2={x} y2={height - 24} stroke="#334155" strokeWidth={1} strokeDasharray="4,3" />
              <text x={x} y={height - 8} textAnchor="middle" fontSize={10} fill="#64748b">
                {ms}ms
              </text>
            </g>
          )
        })}

        {/* Rows */}
        {nodes.map((node, i) => {
          const y = i * rowH
          const barX = labelW + (node.startMs / total) * barAreaW
          const barW = Math.max(4, ((node.endMs - node.startMs) / total) * barAreaW)
          const color = WAVE_COLORS[node.waveIndex % WAVE_COLORS.length] ?? '#6366f1'
          const durationMs = Math.round(node.endMs - node.startMs)

          return (
            <g key={node.name}>
              {/* Row bg on hover — handled via CSS class */}
              <rect x={0} y={y + 2} width={labelW + barAreaW + 40} height={rowH - 4}
                fill={i % 2 === 0 ? '#0f172a' : '#1e293b'} rx={4} />

              {/* Stratum name */}
              <text x={labelW - 8} y={y + rowH / 2 + 5} textAnchor="end" fontSize={12}
                fill="#e2e8f0" fontFamily="ui-monospace, monospace">
                {node.name}
              </text>

              {/* Wave badge */}
              <rect x={4} y={y + rowH / 2 - 8} width={18} height={16} rx={4}
                fill={color} opacity={0.25} />
              <text x={13} y={y + rowH / 2 + 5} textAnchor="middle" fontSize={9}
                fill={color} fontWeight="bold" fontFamily="ui-monospace, monospace">
                {node.waveIndex + 1}
              </text>

              {/* Bar */}
              <rect x={barX} y={y + 8} width={barW} height={rowH - 16} rx={4} fill={color} />

              {/* Duration label inside bar (if wide enough) */}
              {barW > 40 && (
                <text x={barX + barW / 2} y={y + rowH / 2 + 4} textAnchor="middle"
                  fontSize={10} fill="white" fontWeight="600" fontFamily="ui-monospace, monospace">
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
