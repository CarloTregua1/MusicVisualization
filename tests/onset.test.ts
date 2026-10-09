import { describe, expect, it } from 'vitest'
import { Analyzer } from '../src/dsp/analyze'
import { BandMapper } from '../src/dsp/bands'
import { OnsetDetector } from '../src/dsp/onset'

const SR = 44100
const FPS = 60

/** Runs the visualizer's per-frame path over a signal and returns onset times. */
function detect(x: Float32Array): number[] {
  const analyzer = new Analyzer(2048)
  const mapper = new BandMapper(2048, SR)
  const onset = new OnsetDetector(mapper.count)
  const hits: number[] = []
  for (let f = 0; f < (x.length / SR) * FPS; f++) {
    const t = f / FPS
    // Past the end, the window is cut off by zero padding: not a sound event.
    if (Math.round(t * SR) + 1024 > x.length) break
    analyzer.analyze(x, SR, Math.round(t * SR), 1)
    if (onset.update(mapper.map(analyzer.spectrum), t) > 0) hits.push(t)
  }
  return hits
}

let seed = 7
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1

function drums(times: number[], seconds: number, bed = 0.15): Float32Array {
  const x = new Float32Array(seconds * SR)
  for (let n = 0; n < x.length; n++) x[n] = bed * Math.sin((2 * Math.PI * 220 * n) / SR)
  for (const t of times) {
    const s = Math.round(t * SR)
    for (let i = 0; i < 0.15 * SR && s + i < x.length; i++) {
      const env = Math.exp(-i / (0.03 * SR))
      x[s + i] += 0.7 * env * (0.6 * noise() + Math.sin((2 * Math.PI * 70 * i) / SR))
    }
  }
  return x
}

describe('onsets', () => {
  it('fires once per hit, close to the hit', () => {
    const times = [0.8, 1.45, 2.0, 2.6, 3.5, 4.1, 5.0]
    // The tone bed itself starts at t = 0, which is a genuine onset too.
    const hits = detect(drums(times, 6)).filter((t) => t > 0.1)
    expect(hits.length).toBe(times.length)
    hits.forEach((h, i) => expect(Math.abs(h - times[i])).toBeLessThan(0.06))
  })

  it('respects the minimum interval between onsets', () => {
    const times = Array.from({ length: 24 }, (_, i) => 0.3 + i * 0.125)
    const hits = detect(drums(times, 4))
    for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeGreaterThanOrEqual(0.5 - 1e-9)
    expect(hits.length).toBeGreaterThanOrEqual(5)
  })

  it('a sustained tone fires at most once, at its start', () => {
    const x = new Float32Array(5 * SR)
    for (let n = SR; n < x.length; n++) x[n] = 0.5 * Math.sin((2 * Math.PI * 440 * n) / SR)
    const hits = detect(x)
    expect(hits.length).toBeLessThanOrEqual(1)
    if (hits.length) expect(Math.abs(hits[0] - 1)).toBeLessThan(0.06)
  })

  it('silence fires nothing', () => {
    expect(detect(new Float32Array(3 * SR))).toEqual([])
  })
})
