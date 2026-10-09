import { describe, expect, it } from 'vitest'
import { Analyzer } from '../src/dsp/analyze'
import { hannGain, hannOffset, pickPeaks, parabolicOffset } from '../src/dsp/peaks'
import { rms, rmsError, synthesize } from '../src/dsp/resynth'
import { PeakTracker } from '../src/dsp/smoothing'
import { termsToLatex } from '../src/render/formula'
import { noteName } from '../src/render/notes'

const SR = 44100
const W = 2048
const LEN = 16384
const CENTER = 7000 // deliberately not a "nice" index

function tones(parts: { f: number; a: number; p?: number }[], len = LEN): Float32Array {
  const x = new Float32Array(len)
  for (let n = 0; n < len; n++) {
    const t = n / SR
    for (const { f, a, p = 0 } of parts) x[n] += a * Math.sin(2 * Math.PI * f * t + p)
  }
  return x
}

const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x))

describe('acceptance', () => {
  it('pure 440 Hz sine, amp 0.5', () => {
    const terms = new Analyzer(W).analyze(tones([{ f: 440, a: 0.5 }]), SR, CENTER, 10)
    expect(terms.length).toBeGreaterThan(0)
    expect(Math.abs(terms[0].freq - 440)).toBeLessThan(1)
    expect(Math.abs(terms[0].amp - 0.5) / 0.5).toBeLessThan(0.05)
  })

  it('220 Hz + 660 Hz (0.6 / 0.3) both detected, in order', () => {
    const terms = new Analyzer(W).analyze(
      tones([{ f: 220, a: 0.6 }, { f: 660, a: 0.3 }]),
      SR,
      CENTER,
      10,
    )
    expect(terms.length).toBeGreaterThanOrEqual(2)
    expect(Math.abs(terms[0].freq - 220)).toBeLessThan(1)
    expect(Math.abs(terms[1].freq - 660)).toBeLessThan(1)
    expect(terms[0].amp).toBeGreaterThan(terms[1].amp)
  })

  it('recovers phase relative to the window centre', () => {
    const terms = new Analyzer(W).analyze(tones([{ f: 100, a: 1, p: 1.0 }]), SR, CENTER, 10)
    // x(t) = sin(2π·100·t + 1) = sin(2π·100·(t − t₀) + 2π·100·t₀ + 1)
    const expected = wrap(2 * Math.PI * 100 * (CENTER / SR) + 1.0)
    expect(Math.abs(wrap(terms[0].phase - expected))).toBeLessThan(0.1)
  })

  it('reconstructs a 3-tone signal with N=3 to < 2% RMS error', () => {
    const x = tones([
      { f: 330, a: 0.5, p: 0.3 },
      { f: 1234.5, a: 0.3, p: -2 },
      { f: 3100, a: 0.15, p: 2.5 },
    ])
    const terms = new Analyzer(W).analyze(x, SR, CENTER, 3)
    expect(terms.length).toBe(3)
    const start = CENTER - W / 2
    const real = x.subarray(start, start + W)
    const approx = new Float64Array(W)
    synthesize(terms, SR, CENTER, start, approx)
    expect(rmsError(real, approx) / rms(real)).toBeLessThan(0.02)
  })

  it('silence returns no terms', () => {
    expect(new Analyzer(W).analyze(new Float32Array(LEN), SR, CENTER, 10)).toEqual([])
  })
})

describe('details', () => {
  it('works for every supported window size', () => {
    for (const size of [1024, 2048, 4096, 8192]) {
      const terms = new Analyzer(size).analyze(tones([{ f: 440, a: 0.5 }]), SR, CENTER, 10)
      expect(Math.abs(terms[0].freq - 440)).toBeLessThan(1)
      expect(Math.abs(terms[0].amp - 0.5) / 0.5).toBeLessThan(0.05)
    }
  })

  it('respects N and returns terms sorted by amplitude', () => {
    const x = tones([200, 500, 900, 1500, 2600].map((f, i) => ({ f, a: 0.5 / (i + 1) })))
    const terms = new Analyzer(W).analyze(x, SR, CENTER, 3)
    expect(terms.map((t) => Math.round(t.freq / 10) * 10)).toEqual([200, 500, 900])
  })

  it('treats samples outside the buffer as silence', () => {
    const terms = new Analyzer(W).analyze(tones([{ f: 440, a: 0.5 }]), SR, 0, 10)
    expect(Math.abs(terms[0].freq - 440)).toBeLessThan(2)
  })

  it('pickPeaks keeps the strongest local maxima', () => {
    const spec = new Float64Array([0, 0.1, 0.5, 0.1, 0, 0, 0.2, 0.9, 0.2, 0, 0, 0.05, 0.3, 0.05, 0])
    const out = new Int32Array(2)
    expect(pickPeaks(spec, 2, out, 1e-4, 60)).toBe(2)
    expect(Array.from(out)).toEqual([7, 2])
  })

  it('parabolicOffset is 0 for a symmetric peak and leans toward the larger side', () => {
    expect(parabolicOffset(1, 2, 1)).toBeCloseTo(0)
    expect(parabolicOffset(1, 2, 1.5)).toBeGreaterThan(0)
  })

  it('hannOffset inverts the Hann kernel exactly', () => {
    for (const d of [-0.5, -0.31, -0.07, 0, 0.12, 0.4999]) {
      const g = (x: number) => Math.abs(hannGain(x))
      expect(hannOffset(g(-1 - d), g(-d), g(1 - d))).toBeCloseTo(d, 9)
    }
  })

  it('PeakTracker fades new peaks in and converges on steady ones', () => {
    const tr = new PeakTracker(0.5)
    const t = [{ freq: 440, amp: 1, phase: 0 }]
    expect(tr.apply(t)[0].amp).toBeCloseTo(0.5)
    expect(tr.apply(t)[0].amp).toBeCloseTo(0.75)
    tr.reset()
    expect(tr.apply(t)[0].amp).toBeCloseTo(0.5)
  })
})

describe('formatting', () => {
  it('formats terms with the spec precision', () => {
    const tex = termsToLatex([{ freq: 440.04, amp: 0.49999, phase: -1.234 }], false)
    expect(tex).toContain('0.500\\sin')
    expect(tex).toContain('440.0')
    expect(tex).toContain('- 1.23')
  })

  it('names notes against A4 = 440', () => {
    expect(noteName(440)).toBe('A4')
    expect(noteName(261.63)).toBe('C4')
    expect(noteName(445)).toBe('A4 +20¢')
  })
})
