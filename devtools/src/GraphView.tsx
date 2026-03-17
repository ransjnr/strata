import type { StrataTrace } from './types'

const WAVE_ACCENT = ['#46E3B7', '#4C9EEB', '#9B6DFF', '#F5A623', '#E55353', '#F472B6']

interface Props {
  trace: StrataTrace
}

const NODE_R = 28
const H_GAP = 160
const V_GAP = 72
const PAD_X = 48
const PAD_Y = 48

export function GraphView({ trace }: Props) {
  const columns = trace.waves.map((w) => w.parallel)
  const maxRows = Math.max(...columns.map((c) => c.length), 1)
  const W = PAD_X * 2 + columns.length * H_GAP
  const H = PAD_Y * 2 + maxRows * V_GAP

  function nodePos(ci: number, ri: number, total: number) {
    const x = PAD_X + ci * H_GAP + NODE_R
    const colH = total * V_GAP
    const offsetY = (H - colH) / 2
    return { x, y: offsetY + ri * V_GAP + NODE_R }
  }

  const edges: { x1: number; y1: number; x2: number; y2: number; fromColor: string }[] = []
  columns.forEach((col, ci) => {
    if (ci + 1 >= columns.length) return
    const nextCol = columns[ci + 1]!
    const fromColor = WAVE_ACCENT[ci % WAVE_ACCENT.length]!
    col.forEach((_, ri) => {
      const from = nodePos(ci, ri, col.length)
      nextCol.forEach((_, nri) => {
        const to = nodePos(ci + 1, nri, nextCol.length)
        edges.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, fromColor })
      })
    })
  })

  return (
    <div className="graph-wrap">
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <marker id="g-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#3D5070" />
          </marker>
          {WAVE_ACCENT.map((color, i) => (
            <filter key={i} id={`glow-${i}`}>
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          ))}
        </defs>

        {/* Wave column labels */}
        {columns.map((_, ci) => {
          const x = PAD_X + ci * H_GAP + NODE_R
          const color = WAVE_ACCENT[ci % WAVE_ACCENT.length]!
          return (
            <g key={`label-${ci}`}>
              <rect x={x - 30} y={6} width={60} height={20} rx={4}
                fill={`${color}14`} stroke={`${color}30`} strokeWidth={1} />
              <text x={x} y={20} textAnchor="middle" fontSize={10}
                fill={color} fontFamily="'JetBrains Mono', monospace" fontWeight="600" letterSpacing={0.5}>
                WAVE {ci + 1}
              </text>
            </g>
          )
        })}

        {/* Edges */}
        {edges.map((e, i) => (
          <line key={i}
            x1={e.x1 + NODE_R} y1={e.y1}
            x2={e.x2 - NODE_R} y2={e.y2}
            stroke="#1D2B45" strokeWidth={1.5}
            markerEnd="url(#g-arrow)" />
        ))}

        {/* Parallel bracket */}
        {columns.map((col, ci) => {
          if (col.length < 2) return null
          const color = WAVE_ACCENT[ci % WAVE_ACCENT.length]!
          const { x, y: y0 } = nodePos(ci, 0, col.length)
          const { y: y1 } = nodePos(ci, col.length - 1, col.length)
          const bx = x - NODE_R - 14
          return (
            <g key={`bracket-${ci}`}>
              <line x1={bx} y1={y0} x2={bx} y2={y1}
                stroke={`${color}40`} strokeWidth={1.5} strokeDasharray="3,3" />
              <line x1={bx} y1={y0} x2={bx + 6} y2={y0}
                stroke={`${color}40`} strokeWidth={1.5} />
              <line x1={bx} y1={y1} x2={bx + 6} y2={y1}
                stroke={`${color}40`} strokeWidth={1.5} />
            </g>
          )
        })}

        {/* Nodes */}
        {columns.map((col, ci) =>
          col.map((name, ri) => {
            const { x, y } = nodePos(ci, ri, col.length)
            const color = WAVE_ACCENT[ci % WAVE_ACCENT.length]!
            const wave = trace.waves[ci]!
            return (
              <g key={name}>
                {/* Glow ring */}
                <circle cx={x} cy={y} r={NODE_R + 8} fill={color} opacity={0.06} />
                {/* Outer ring */}
                <circle cx={x} cy={y} r={NODE_R + 1} fill="none"
                  stroke={color} strokeWidth={1} opacity={0.3} />
                {/* Node */}
                <circle cx={x} cy={y} r={NODE_R} fill="#131929" stroke={color} strokeWidth={1.5} />

                {/* Name */}
                <text x={x} y={y + (name.length > 8 ? -3 : 5)} textAnchor="middle"
                  fontSize={name.length > 9 ? 9 : 11} fill="#E8EDF5"
                  fontFamily="'JetBrains Mono', monospace" fontWeight="600">
                  {name.length > 11 ? name.slice(0, 10) + '…' : name}
                </text>

                {/* Duration */}
                {name.length > 8 && (
                  <text x={x} y={y + 12} textAnchor="middle"
                    fontSize={9} fill={color}
                    fontFamily="'JetBrains Mono', monospace">
                    {Math.round(wave.ms)}ms
                  </text>
                )}
              </g>
            )
          })
        )}
      </svg>
    </div>
  )
}
