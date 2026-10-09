/** One sinusoidal term: amp · sin(2π · freq · (t − t₀) + phase). */
export interface Term {
  freq: number
  amp: number
  phase: number
}
