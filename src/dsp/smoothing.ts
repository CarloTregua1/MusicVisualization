import type { Term } from '../types'

/**
 * Cross-frame peak tracking: each term is matched to the nearest-frequency
 * term from the previous frame, and its amplitude is smoothed with an EMA.
 * Unmatched (new) terms fade in from zero. Keeps its own copy of the terms.
 */
export class PeakTracker {
  /** EMA weight of the newest frame, in (0, 1]. */
  alpha: number
  private prev: Term[] = []
  private next: Term[] = []

  constructor(alpha = 0.35) {
    this.alpha = alpha
  }

  reset(): void {
    this.prev.length = 0
  }

  apply(terms: readonly Term[]): Term[] {
    const { prev, alpha } = this
    const next = this.next
    next.length = terms.length
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i]
      const tol = Math.max(3, t.freq * 0.03)
      let prevAmp = 0
      let best = tol
      for (const p of prev) {
        const d = Math.abs(p.freq - t.freq)
        if (d < best) {
          best = d
          prevAmp = p.amp
        }
      }
      const slot = next[i] ?? (next[i] = { freq: 0, amp: 0, phase: 0 })
      slot.freq = t.freq
      slot.phase = t.phase
      slot.amp = alpha * t.amp + (1 - alpha) * prevAmp
    }
    next.sort((a, b) => b.amp - a.amp)
    // Swap buffers: what we return becomes the reference for the next frame.
    this.next = prev
    this.prev = next
    return next
  }
}
