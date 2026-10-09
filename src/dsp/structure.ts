import type { TempoTrack } from './tempo'

/** Beats per bar assumed for downbeat finding (4/4 covers almost all dance music). */
export const BEATS_PER_BAR = 4

/**
 * Which beat (0..3) of the beat grid is the downbeat (beat one of a bar).
 * Downbeats usually carry the strongest onsets (kick, chord changes), so the
 * offset whose beats have the most onset strength in total wins.
 */
export function findDownbeat(beats: Float32Array, tempo: TempoTrack): number {
  const { envelope, hopSec, envelopeStart } = tempo
  const score = new Float64Array(BEATS_PER_BAR)
  for (let i = 0; i < beats.length; i++) {
    const f = Math.round((beats[i] - envelopeStart) / hopSec)
    // Strongest onset within ±2 frames of the beat.
    let v = 0
    for (let k = Math.max(0, f - 2); k <= Math.min(envelope.length - 1, f + 2); k++) v = Math.max(v, envelope[k])
    score[i % BEATS_PER_BAR] += v
  }
  let best = 0
  for (let k = 1; k < BEATS_PER_BAR; k++) if (score[k] > score[best]) best = k
  return best
}

/** A drop must be at least this much louder than the build before it (dB). */
const DROP_RISE_DB = 6
/** Drops closer than this many beats are the same drop. */
const DROP_MIN_GAP_BEATS = 16

/**
 * Times of drops: beats where the music bursts out after a quieter build.
 * Loudness is measured per beat; a drop is a beat whose next 4 beats are at
 * least DROP_RISE_DB louder than the 8 before it, and loud for this song
 * (above its median). Of several candidates close together, the strongest
 * rise wins.
 */
export function findDrops(mono: Float32Array, sampleRate: number, beats: Float32Array): Float32Array {
  const n = beats.length
  if (n < 13) return new Float32Array(0)
  const db = new Float64Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    const a = Math.max(0, Math.round(beats[i] * sampleRate))
    const b = Math.min(mono.length, Math.round(beats[i + 1] * sampleRate))
    let sum = 0
    for (let k = a; k < b; k++) sum += mono[k] * mono[k]
    db[i] = 10 * Math.log10(sum / Math.max(1, b - a) + 1e-10)
  }
  const median = Float64Array.from(db).sort()[db.length >> 1]
  const mean = (a: number, b: number) => {
    let s = 0
    for (let i = a; i < b; i++) s += db[i]
    return s / (b - a)
  }
  const candidates: { beat: number; rise: number }[] = []
  for (let i = 8; i + 4 <= db.length; i++) {
    const after = mean(i, i + 4)
    const rise = after - mean(i - 8, i)
    if (rise >= DROP_RISE_DB && after > median) candidates.push({ beat: i, rise })
  }
  // Keep the strongest rise in each cluster.
  const drops: number[] = []
  candidates.sort((x, y) => y.rise - x.rise)
  for (const c of candidates) if (drops.every((d) => Math.abs(d - c.beat) >= DROP_MIN_GAP_BEATS)) drops.push(c.beat)
  drops.sort((x, y) => x - y)
  return Float32Array.from(drops, (i) => beats[i])
}
