/**
 * Real-time onset detector over band levels (0..1 per band), as produced by
 * BandMapper at the playhead. An onset is a frame whose positive spectral
 * flux (summed level rises across bands) clearly beats its recent average.
 * Steady notes and silence produce nothing; only new sound events fire.
 */
export class OnsetDetector {
  /** Shortest gap between two onsets, in seconds of audio time. */
  minInterval: number
  private readonly prev: Float32Array
  private avg = 0
  private last = -Infinity
  private lastTime = NaN

  constructor(bands: number, minInterval = 0.5) {
    this.prev = new Float32Array(bands)
    this.minInterval = minInterval
  }

  reset() {
    this.prev.fill(0)
    this.avg = 0
    this.last = -Infinity
    this.lastTime = NaN
  }

  /**
   * Feeds the levels at audio time `t` and returns the onset strength in
   * (0, 1], or 0 when this frame is not an onset.
   */
  update(levels: Float32Array, t: number): number {
    const dt = t - this.lastTime
    // First frame, a seek, or a pause: re-seed instead of reporting a jump.
    if (!(dt > 0) || dt > 0.25) {
      this.prev.set(levels)
      this.lastTime = t
      if (dt < 0 || dt > 0.25) this.last = -Infinity
      return 0
    }
    this.lastTime = t
    let flux = 0
    let total = 0
    for (let b = 0; b < levels.length; b++) {
      const d = levels[b] - this.prev[b]
      if (d > 0) flux += d
      total += levels[b]
    }
    this.prev.set(levels)
    // Normalize to a per-second rate so the frame rate doesn't matter.
    const rate = flux / dt
    const threshold = Math.max(12, this.avg * 2.2)
    const loudEnough = total / levels.length > 0.12
    this.avg += (rate - this.avg) * (1 - Math.exp(-dt / 0.5))
    if (rate > threshold && loudEnough && t - this.last >= this.minInterval) {
      this.last = t
      return Math.min(1, rate / threshold / 2)
    }
    return 0
  }
}
