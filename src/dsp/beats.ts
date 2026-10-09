import { tempoAt, type TempoTrack } from './tempo'

/** How strongly beat gaps are held to the expected period (Ellis' "tightness"). */
const TIGHTNESS = 100
/** Tempo used where the track has none (silence). */
const FALLBACK_BPM = 120

/**
 * Offline beat tracker (dynamic programming, after Ellis 2007). Each frame's
 * score is its onset strength plus the best score of an earlier beat, minus
 * a penalty for how far the gap strays from the expected beat period at
 * that moment (from the tempo curve, so tempo changes are followed). The
 * best final beat is then traced back. Yields progress 0..1; returns beat
 * times in seconds.
 */
export function* trackBeats(tempo: TempoTrack): Generator<number, Float32Array> {
  const { envelope, hopSec, envelopeStart } = tempo
  const n = envelope.length
  if (n === 0) return new Float32Array(0)

  // Normalize the envelope so TIGHTNESS means the same for every song.
  let sum = 0
  let sq = 0
  for (let i = 0; i < n; i++) {
    sum += envelope[i]
    sq += envelope[i] * envelope[i]
  }
  const mean = sum / n
  const std = Math.sqrt(Math.max(1e-12, sq / n - mean * mean))
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) env[i] = envelope[i] / std

  const score = new Float32Array(n)
  const back = new Int32Array(n).fill(-1)
  let lastBpm = FALLBACK_BPM
  for (let i = 0; i < n; i++) {
    const bpm = tempoAt(tempo, envelopeStart + i * hopSec)
    if (!Number.isNaN(bpm)) lastBpm = bpm
    const period = 60 / lastBpm / hopSec
    let best = -Infinity
    let arg = -1
    const from = Math.max(0, Math.round(i - 2 * period))
    const to = Math.round(i - period / 2)
    for (let j = from; j <= to; j++) {
      const r = Math.log((i - j) / period)
      const v = score[j] - TIGHTNESS * r * r
      if (v > best) {
        best = v
        arg = j
      }
    }
    score[i] = env[i] + (arg >= 0 ? best : 0)
    back[i] = arg
    if (i % 2048 === 2047) yield (0.9 * i) / n
  }

  // End on the best-scoring frame within the last beat period, then trace back.
  const lastPeriod = Math.round(60 / lastBpm / hopSec)
  let end = n - 1
  for (let i = Math.max(0, n - lastPeriod); i < n; i++) if (score[i] > score[end]) end = i
  const frames: number[] = []
  for (let i = end; i >= 0; i = back[i]) frames.push(i)
  frames.reverse()
  return Float32Array.from(frames, (f) => envelopeStart + f * hopSec)
}

export interface BeatPhase {
  /** Index of the most recent beat (can be −1 before the first). */
  index: number
  /** Position between that beat and the next, 0..1. */
  phase: number
  /** Length of the current beat, seconds. */
  period: number
}

/** Where time t sits in the beat grid (extrapolated before the first and after the last beat). */
export function beatPhase(beats: Float32Array, t: number): BeatPhase {
  const n = beats.length
  if (n < 2) {
    const period = 60 / FALLBACK_BPM
    const x = t / period
    return { index: Math.floor(x), phase: x - Math.floor(x), period }
  }
  if (t < beats[0]) {
    const period = beats[1] - beats[0]
    const x = (t - beats[0]) / period
    const k = Math.floor(x)
    return { index: k, phase: x - k, period }
  }
  if (t >= beats[n - 1]) {
    const period = beats[n - 1] - beats[n - 2]
    const x = (t - beats[n - 1]) / period
    const k = Math.floor(x)
    return { index: n - 1 + k, phase: x - k, period }
  }
  // Largest beat <= t.
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (beats[mid] <= t) lo = mid
    else hi = mid
  }
  const period = beats[lo + 1] - beats[lo]
  return { index: lo, phase: (t - beats[lo]) / period, period }
}
