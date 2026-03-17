import type { StrataTrace } from './types'

const WAVE_COLORS = [
  '#6366f1',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
]

interface Props {
  trace: StrataTrace
}

const NODE_R = 24
const H_GAP = 140
const V_GAP = 64
const PAD = 40

export function WaveGraph({ trace }: Props) {
  // Lay out nodes: each wave is a column, strata within a wave are rows
  const columns = trace.waves.map((wave) => wave.parallel)
  const maxRows = Math.max(...columns.map((c) => c.length))

  const W = PAD * 2 + columns.length * H_GAP
  const H = PAD * 2 + maxRows * V_GAP

  // Centre each column vertically
  function nodePos(colIdx: number, rowIdx: number, totalInCol: number) {
    const x = PAD + colIdx * H_GAP + NODE_R
    const colH = totalInCol * V_GAP
    const offsetY = (H - colH) / 2
    const y = offsetY + rowIdx * V_GAP + NODE_R
    return { x, y }
  }

  // Build edges: every node in wave N connects to every node in wave N+1
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = []
  columns.forEach((col, ci) => {
    if (ci + 1 >= columns.length) return
    const nextCol = columns[ci + 1]!
    col.forEach((_, ri) => {
      const from = nodePos(ci, ri, col.length)
      nextCol.forEach((_, nri) => {
        const to = nodePos(ci + 1, nri, nextCol.length)
        edges.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y })
      })
    })
  })

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* Wave labels */}
        {columns.map((_, ci) => {
          const x = PAD + ci * H_GAP + NODE_R
          return (
            <text key={ci} x={x} y={14} textAnchor="middle" fontSize={10}
              fill="#475569" fontFamily="ui-monospace, monospace" letterSpacing={1}>
              WAVE {ci + 1}
            </text>
          )
        })}

        {/* Edges */}
        {edges.map((e, i) => (
          <line key={i} x1={e.x1 + NODE_R} y1={e.y1} x2={e.x2 - NODE_R} y2={e.y2}
            stroke="#334155" strokeWidth={1.5} markerEnd="url(#arrow)" />
        ))}

        {/* Arrow marker */}
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#475569" />
          </marker>
        </defs>

        {/* Nodes */}
        {columns.map((col, ci) =>
          col.map((name, ri) => {
            const { x, y } = nodePos(ci, ri, col.length)
            const color = WAVE_COLORS[ci % WAVE_COLORS.length] ?? '#6366f1'
            const wave = trace.waves[ci]!
            return (
              <g key={name}>
                {/* Glow */}
                <circle cx={x} cy={y} r={NODE_R + 4} fill={color} opacity={0.12} />
                {/* Circle */}
                <circle cx={x} cy={y} r={NODE_R} fill="#1e293b" stroke={color} strokeWidth={2} />
                {/* Name — wrap if long */}
                <text x={x} y={name.length > 8 ? y - 4 : y + 4} textAnchor="middle"
                  fontSize={name.length > 8 ? 9 : 11} fill="#e2e8f0"
                  fontFamily="ui-monospace, monospace" fontWeight="600">
                  {name.length > 10 ? name.slice(0, 9) + '…' : name}
                </text>
                {/* Duration badge */}
                <text x={x} y={y + (name.length > 8 ? 12 : 0)} textAnchor="middle"
                  fontSize={9} fill={color} fontFamily="ui-monospace, monospace">
                  {Math.round(wave.ms)}ms
                </text>
              </g>
            )
          })
        )}

        {/* "parallel" labels between waves */}
        {columns.map((col, ci) => {
          if (col.length < 2) return null
          const { x, y } = nodePos(ci, 0, col.length)
          const { y: y2 } = nodePos(ci, col.length - 1, col.length)
          const midY = (y + y2) / 2
          return (
            <g key={`p-${ci}`}>
              <line x1={x - NODE_R - 8} y1={y} x2={x - NODE_R - 8} y2={y2}
                stroke="#475569" strokeWidth={1} strokeDasharray="3,3" />
              <text x={x - NODE_R - 14} y={midY + 4} textAnchor="middle"
                fontSize={8} fill="#475569" transform={`rotate(-90, ${x - NODE_R - 14}, ${midY})`}
                fontFamily="ui-monospace, monospace" letterSpacing={1}>
                PARALLEL
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
