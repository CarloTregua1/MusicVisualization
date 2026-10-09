import type { Term } from '../types'
import { Analyzer } from './analyze'
import { hann } from './window'

/**
 * Writes Σ amp · sin(2π·freq·(t − t₀) + phase) into `out`, where out[i]
 * is the sample at index `start + i` and t₀ is sample index `center`.
 */
export function synthesize(
  terms: readonly Term[],
  sampleRate: number,
  center: number,
  start: number,
  out: Float32Array | Float64Array,
): void {
  out.fill(0)
  const offset = start - center
  for (const { freq, amp, phase } of terms) {
    // sin recurrence: s[i+1] = 2cos(ω)·s[i] − s[i−1]; stable in float64 over
    // the window lengths we use, and far cheaper than Math.sin per sample.
    const w = (2 * Math.PI * freq) / sampleRate
    const k = 2 * Math.cos(w)
    let prev = amp * Math.sin(w * (offset - 1) + phase)
    let cur = amp * Math.sin(w * offset + phase)
    for (let i = 0; i < out.length; i++) {
      out[i] += cur
      const next = k * cur - prev
      prev = cur
      cur = next
    }
  }
}

export function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return to > from ? Math.sqrt(s / (to - from)) : 0
}

/** RMS of (a − b) over the overlapping range. */
export function rmsError(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i]
    s += d * d
  }
  return n ? Math.sqrt(s / n) : 0
}

/**
 * Rebuilds a whole track from its N-term expressions: one frame every
 * size/2 samples, each synthesized over the frame and Hann-weighted, then
 * overlap-added (periodic Hann at 50% overlap sums to exactly 1).
 * Yields progress in [0, 1] between chunks so callers can stay responsive.
 */
export function* resynthesizeTrack(
  signal: Float32Array,
  sampleRate: number,
  size: number,
  maxTerms: number,
  out: Float32Array,
): Generator<number, void> {
  const analyzer = new Analyzer(size)
  const w = hann(size).coeffs
  const hop = size >> 1
  const seg = new Float64Array(size)
  out.fill(0)
  const frames = Math.ceil(signal.length / hop) + 1
  for (let f = 0; f < frames; f++) {
    const center = f * hop
    const start = center - hop
    const terms = analyzer.analyze(signal, sampleRate, center, maxTerms)
    synthesize(terms, sampleRate, center, start, seg)
    for (let i = 0; i < size; i++) {
      const idx = start + i
      if (idx >= 0 && idx < out.length) out[idx] += seg[i] * w[i]
    }
    if (f % 64 === 63) yield f / frames
  }
}
