import { describe, expect, it } from 'vitest'
import { analyzeTempo, runToEnd, tempoAt } from '../src/dsp/tempo'

const SR = 44100

/** Decaying noise-burst "kick" on every beat over a quiet tone bed. */
function clickTrack(segments: { bpm: number; seconds: number }[]): Float32Array {
  const total = segments.reduce((s, x) => s + x.seconds, 0)
  const x = new Float32Array(Math.round(total * SR))
  let rand = 1
  const noise = () => ((rand = (rand * 16807) % 2147483647) / 2147483647) * 2 - 1
  let t0 = 0
  for (const { bpm, seconds } of segments) {
    const period = 60 / bpm
    for (let beat = t0; beat < t0 + seconds - 1e-9; beat += period) {
      const s = Math.round(beat * SR)
      for (let i = 0; i < 0.06 * SR && s + i < x.length; i++) {
        const env = Math.exp(-i / (0.012 * SR))
        x[s + i] += 0.6 * env * (noise() * 0.5 + Math.sin((2 * Math.PI * 60 * i) / SR))
      }
    }
    t0 += seconds
  }
  for (let n = 0; n < x.length; n++) x[n] += 0.05 * Math.sin((2 * Math.PI * 330 * n) / SR)
  return x
}

describe('tempo', () => {
  for (const bpm of [90, 120, 150]) {
    it(`detects a steady ${bpm} BPM pulse`, () => {
      const track = runToEnd(analyzeTempo(clickTrack([{ bpm, seconds: 16 }]), SR))
      expect(Math.abs(tempoAt(track, 8) - bpm)).toBeLessThan(2)
    })
  }

  it('follows a tempo change', () => {
    const track = runToEnd(analyzeTempo(clickTrack([{ bpm: 85, seconds: 14 }, { bpm: 160, seconds: 14 }]), SR))
    expect(Math.abs(tempoAt(track, 5) - 85)).toBeLessThan(3)
    expect(Math.abs(tempoAt(track, 23) - 160)).toBeLessThan(3)
  })

  it('reports no tempo for silence', () => {
    const track = runToEnd(analyzeTempo(new Float32Array(SR * 10), SR))
    expect(Number.isNaN(tempoAt(track, 5))).toBe(true)
  })
})
