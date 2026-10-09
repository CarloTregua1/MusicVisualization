import { describe, expect, it } from 'vitest'
import { beatPhase, trackBeats } from '../src/dsp/beats'
import { analyzeTempo, runToEnd } from '../src/dsp/tempo'

const SR = 44100

/** Decaying noise-burst "kick" on every beat over a quiet tone bed; returns the signal and click times. */
function clickTrack(segments: { bpm: number; seconds: number }[]) {
  const total = segments.reduce((s, x) => s + x.seconds, 0)
  const x = new Float32Array(Math.round(total * SR))
  const clicks: number[] = []
  let rand = 1
  const noise = () => ((rand = (rand * 16807) % 2147483647) / 2147483647) * 2 - 1
  let t0 = 0
  for (const { bpm, seconds } of segments) {
    for (let beat = t0 + 0.25; beat < t0 + seconds - 1e-9; beat += 60 / bpm) {
      clicks.push(beat)
      const s = Math.round(beat * SR)
      for (let i = 0; i < 0.06 * SR && s + i < x.length; i++) {
        x[s + i] += 0.6 * Math.exp(-i / (0.012 * SR)) * (noise() * 0.5 + Math.sin((2 * Math.PI * 60 * i) / SR))
      }
    }
    t0 += seconds
  }
  for (let n = 0; n < x.length; n++) x[n] += 0.05 * Math.sin((2 * Math.PI * 330 * n) / SR)
  return { x, clicks }
}

/** Fraction of clicks with a tracked beat within ±tol seconds. */
function hitRate(beats: Float32Array, clicks: number[], tol = 0.04) {
  let hit = 0
  for (const c of clicks) if (beats.some((b) => Math.abs(b - c) <= tol)) hit++
  return hit / clicks.length
}

describe('beat tracking', () => {
  for (const bpm of [90, 120, 150]) {
    it(`finds the beats of a steady ${bpm} BPM pulse`, () => {
      const { x, clicks } = clickTrack([{ bpm, seconds: 16 }])
      const beats = runToEnd(trackBeats(runToEnd(analyzeTempo(x, SR))))
      expect(hitRate(beats, clicks)).toBeGreaterThanOrEqual(0.9)
      // Not double-counting: about one beat per click.
      expect(beats.length).toBeLessThanOrEqual(clicks.length * 1.15)
    })
  }

  it('follows a tempo change', () => {
    const { x, clicks } = clickTrack([{ bpm: 85, seconds: 14 }, { bpm: 160, seconds: 14 }])
    const beats = runToEnd(trackBeats(runToEnd(analyzeTempo(x, SR))))
    expect(hitRate(beats, clicks)).toBeGreaterThanOrEqual(0.85)
  })
})

describe('beatPhase', () => {
  const beats = Float32Array.from([1, 1.5, 2, 2.5])
  it('gives index and phase between and at beats', () => {
    expect(beatPhase(beats, 1.25)).toEqual({ index: 0, phase: 0.5, period: 0.5 })
    expect(beatPhase(beats, 2)).toMatchObject({ index: 2, phase: 0 })
  })
  it('extrapolates before the first and after the last beat', () => {
    expect(beatPhase(beats, 0.75)).toMatchObject({ index: -1, phase: 0.5 })
    expect(beatPhase(beats, 3.25)).toMatchObject({ index: 4, phase: 0.5 })
  })
})
