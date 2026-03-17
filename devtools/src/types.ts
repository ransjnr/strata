export interface ExecutionWave {
  parallel: string[]
  ms: number
}

export interface StrataTrace {
  totalMs: number
  waves: ExecutionWave[]
}

export interface StratumNode {
  name: string
  waveIndex: number
  startMs: number
  endMs: number
}
