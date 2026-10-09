/** Default absolute floor: −80 dBFS in amplitude units. */
export const DEFAULT_FLOOR = 1e-4
/** Peaks more than this many dB below the strongest peak are dropped. */
export const DEFAULT_RANGE_DB = 60

/**
 * Finds the indices of the strongest local maxima in an amplitude spectrum.
 * A bin counts as a peak when it beats its ±1 neighbours and is not beaten
 * by its ±2 neighbours, which rejects the Hann window's side lobes.
 * Writes up to `maxPeaks` indices into `out`, strongest first, and returns
 * how many were written. Allocation-free.
 */
export function pickPeaks(
  spec: Float64Array,
  maxPeaks: number,
  out: Int32Array,
  floor = DEFAULT_FLOOR,
  rangeDb = DEFAULT_RANGE_DB,
): number {
  const bins = spec.length
  let count = 0
  for (let k = 1; k < bins - 1; k++) {
    const m = spec[k]
    if (m <= floor || m <= spec[k - 1] || m <= spec[k + 1]) continue
    if ((k >= 2 && spec[k - 2] > m) || (k + 2 < bins && spec[k + 2] > m)) continue
    // Insertion into the sorted top-N list.
    let i: number
    if (count < maxPeaks) i = count++
    else if (spec[out[maxPeaks - 1]] < m) i = maxPeaks - 1
    else continue
    while (i > 0 && spec[out[i - 1]] < m) {
      out[i] = out[i - 1]
      i--
    }
    out[i] = k
  }
  if (count === 0) return 0
  const minAmp = spec[out[0]] * Math.pow(10, -rangeDb / 20)
  while (count > 0 && spec[out[count - 1]] < minAmp) count--
  return count
}

/**
 * Parabolic interpolation through three log-magnitudes (α, β, γ) around a
 * peak. Returns the fractional bin offset p ∈ [−0.5, 0.5].
 */
export function parabolicOffset(alpha: number, beta: number, gamma: number): number {
  const denom = alpha - 2 * beta + gamma
  if (denom === 0) return 0
  const p = (0.5 * (alpha - gamma)) / denom
  return p < -0.5 ? -0.5 : p > 0.5 ? 0.5 : p
}

/** Height of the interpolated parabola at offset p. */
export function parabolicPeak(alpha: number, beta: number, gamma: number, p: number): number {
  return beta - 0.25 * (alpha - gamma) * p
}

/**
 * Exact sub-bin offset for a Hann-windowed sinusoid, from the linear
 * magnitudes (a, b, c) of bins k−1, k, k+1. Hann's kernel gives
 * |X(k+1)|/|X(k)| = (1+δ)/(2−δ), so δ = (2c − b)/(b + c), mirrored for
 * the left side. Log-parabolic fitting is biased by up to ~0.02 bins on
 * Hann; this removes that bias, which matters for phase coherence across
 * the window.
 */
export function hannOffset(a: number, b: number, c: number): number {
  const d = c >= a ? (2 * c - b) / (b + c) : (b - 2 * a) / (a + b)
  return d < -0.5 ? -0.5 : d > 0.5 ? 0.5 : d || 0
}

/** Hann kernel magnitude at a fractional bin offset δ, normalized to 1 at δ = 0. */
export function hannGain(d: number): number {
  if (Math.abs(d) < 1e-9) return 1
  return Math.sin(Math.PI * d) / (Math.PI * d * (1 - d * d))
}
