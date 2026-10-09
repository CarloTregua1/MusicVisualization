import type { Term } from '../types'
import { RealFFT } from './fft'
import { pickPeaks, hannOffset, hannGain, DEFAULT_FLOOR, DEFAULT_RANGE_DB } from './peaks'
import { hann, type Window } from './window'

export const MAX_TERMS = 64
function wrapPhase(x: number): number {
  x = (x + Math.PI) % (2 * Math.PI)
  if (x < 0) x += 2 * Math.PI
  return x - Math.PI
}

/**
 * Turns one analysis frame into a list of sinusoids. Owns every buffer it
 * needs, so `analyze` does not allocate. The returned array and its Term
 * objects are reused by the next call: copy them if you need to keep them.
 */
export class Analyzer {
  readonly size: number
  /** Amplitude spectrum of the last frame, bins 0..size/2 (amplitude units). */
  readonly spectrum: Float64Array
  /** FFT bins of the terms returned by the last call, parallel to the result. */
  readonly peakBins: Int32Array
  floor = DEFAULT_FLOOR
  rangeDb = DEFAULT_RANGE_DB

  private readonly window: Window
  private readonly fft: RealFFT
  private readonly frame: Float64Array
  private readonly pool: Term[]
  private readonly result: Term[] = []

  constructor(size: number) {
    this.size = size
    this.window = hann(size)
    this.fft = new RealFFT(size)
    this.frame = new Float64Array(size)
    this.spectrum = new Float64Array(size / 2 + 1)
    this.peakBins = new Int32Array(MAX_TERMS)
    this.pool = Array.from({ length: MAX_TERMS }, () => ({ freq: 0, amp: 0, phase: 0 }))
  }

  /**
   * Analyzes the `size` samples of `signal` centred on `center`; samples
   * outside the signal count as silence. Phases are referenced to t₀ = center.
   */
  analyze(signal: Float32Array, sampleRate: number, center: number, maxTerms: number): Term[] {
    const { size, frame, spectrum } = this
    const w = this.window.coeffs
    const half = size >> 1
    const start = center - half
    const len = signal.length

    // Window, then rotate so the centre sample lands at index 0 (fftshift).
    for (let n = 0; n < size; n++) {
      const idx = start + n
      const x = idx >= 0 && idx < len ? signal[idx] : 0
      frame[(n + half) & (size - 1)] = x * w[n]
    }

    const out = this.fft.transform(frame)
    const scale = 2 / this.window.sum
    for (let k = 0; k <= half; k++) {
      const re = out[2 * k]
      const im = out[2 * k + 1]
      spectrum[k] = Math.sqrt(re * re + im * im) * scale
    }

    const n = pickPeaks(spectrum, Math.min(maxTerms, MAX_TERMS), this.peakBins, this.floor, this.rangeDb)
    const result = this.result
    result.length = n
    const binHz = sampleRate / size
    for (let i = 0; i < n; i++) {
      const k = this.peakBins[i]
      const p = hannOffset(spectrum[k - 1], spectrum[k], spectrum[k + 1])
      const term = this.pool[i]
      term.freq = (k + p) * binHz
      term.amp = spectrum[k] / hannGain(p)
      // FFT phase is that of a cosine; sin(x + π/2) = cos(x).
      term.phase = wrapPhase(Math.atan2(out[2 * k + 1], out[2 * k]) + Math.PI / 2)
      result[i] = term
    }
    return result
  }
}
