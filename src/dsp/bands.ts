/**
 * Log-spaced frequency bands over an amplitude spectrum, each reported as a
 * 0..1 level on a dB scale. Allocation-free after construction.
 */
export class BandMapper {
  readonly count: number
  readonly levels: Float32Array
  private readonly lo: Int32Array
  private readonly hi: Int32Array
  private readonly floorDb: number
  private readonly rangeDb: number

  constructor(fftSize: number, sampleRate: number, count = 48, fMin = 40, fMax = 14000, floorDb = -72, rangeDb = 54) {
    this.count = count
    this.levels = new Float32Array(count)
    this.lo = new Int32Array(count)
    this.hi = new Int32Array(count)
    this.floorDb = floorDb
    this.rangeDb = rangeDb
    const binHz = sampleRate / fftSize
    const top = Math.min(fMax, sampleRate / 2 - binHz)
    for (let b = 0; b < count; b++) {
      const f0 = fMin * Math.pow(top / fMin, b / count)
      const f1 = fMin * Math.pow(top / fMin, (b + 1) / count)
      const k0 = Math.max(1, Math.floor(f0 / binHz))
      this.lo[b] = k0
      this.hi[b] = Math.max(k0 + 1, Math.ceil(f1 / binHz))
    }
  }

  /** Fills and returns `levels` from an amplitude spectrum (as produced by Analyzer). */
  map(spectrum: Float64Array): Float32Array {
    const { levels, lo, hi, floorDb, rangeDb } = this
    for (let b = 0; b < this.count; b++) {
      let m = 0
      for (let k = lo[b]; k < hi[b] && k < spectrum.length; k++) if (spectrum[k] > m) m = spectrum[k]
      const db = 20 * Math.log10(m + 1e-9)
      const v = (db - floorDb) / rangeDb
      levels[b] = v < 0 ? 0 : v > 1 ? 1 : v
    }
    return levels
  }
}
