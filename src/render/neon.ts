/**
 * Neon palette. Position along the spectrum (0 = bass, 1 = treble) picks a
 * hue within a band; temperature (0 = cold / slow, 1 = hot / fast) slides
 * that band from violet → electric blue → aqua to magenta → red → gold.
 * Hues are interpolated linearly without wrapping, so the cold→hot path
 * travels through blue/violet/pink and never through muddy greens.
 */
const COLD = [268, 168] // violet → aqua
const HOT = [318, 412] // hot pink → red → gold (412 ≡ 52)

export function neonHue(temperature: number, position: number): number {
  const a = COLD[0] + (HOT[0] - COLD[0]) * temperature
  const b = COLD[1] + (HOT[1] - COLD[1]) * temperature
  return (a + (b - a) * position) % 360
}

export function neon(temperature: number, position: number, lightness = 60, alpha = 1): string {
  return `hsla(${neonHue(temperature, position).toFixed(1)}, 100%, ${lightness}%, ${alpha})`
}

/** Maps BPM to temperature: ≤ 80 BPM fully cold, ≥ 160 BPM fully hot. */
export function bpmToTemperature(bpm: number): number {
  if (Number.isNaN(bpm)) return 0.5
  const t = (bpm - 80) / 80
  return t < 0 ? 0 : t > 1 ? 1 : t
}
