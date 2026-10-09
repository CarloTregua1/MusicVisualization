/**
 * Lightness ceiling for every tube except the innermost (white) one. Above
 * roughly this, a saturated neon colour starts to read as white, and only
 * the innermost tube may ever be white.
 */
export const MAX_COLOUR_LIGHTNESS = 70

/**
 * Tube colour as an `hsl()` string. Age drives the hue ramp, as in the
 * reference: tubes just out of development are pink, older ones cool through
 * purple and blue to teal. Tempo shifts the ramp colder or hotter, and the
 * position around the spectrum tints it. `light` sets the brightness.
 *
 * `white` (0..1) is only for the innermost tube, which burns toward white.
 * With `white` = 0 the colour stays fully saturated and never brighter than
 * MAX_COLOUR_LIGHTNESS, so no other tube can look white however brightly it
 * is lit.
 */
export function tubeColor(temperature: number, depth: number, pos: number, tint: number, light: number, white: number): string {
  const hue = 320 - 135 * depth + (temperature - 0.5) * 110 + (pos - 0.5) * 36 + tint
  const lit = 4 + 54 * light
  let lightness: number
  let sat: number
  if (white > 0) {
    lightness = Math.min(97, Math.max(2, lit + (97 - lit) * white))
    sat = 100 - 80 * white
  } else {
    lightness = Math.min(MAX_COLOUR_LIGHTNESS, Math.max(2, lit))
    sat = 100
  }
  return `hsl(${(((hue % 360) + 360) % 360).toFixed(0)}, ${sat.toFixed(0)}%, ${lightness.toFixed(0)}%)`
}
