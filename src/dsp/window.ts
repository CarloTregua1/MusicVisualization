export interface Window {
  coeffs: Float64Array
  /** Σ w[n], used to undo the window's gain on amplitudes. */
  sum: number
}

const cache = new Map<number, Window>()

/**
 * Periodic Hann window, cached per size. The periodic form is exactly
 * symmetric about n = size/2, which is what makes the center-referenced
 * phase flat across the main lobe.
 */
export function hann(size: number): Window {
  let w = cache.get(size)
  if (!w) {
    const coeffs = new Float64Array(size)
    let sum = 0
    for (let n = 0; n < size; n++) {
      coeffs[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size)
      sum += coeffs[n]
    }
    w = { coeffs, sum }
    cache.set(size, w)
  }
  return w
}
