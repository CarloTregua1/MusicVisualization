/**
 * Lightness ceiling for every tube except the innermost (white) one. Above
 * roughly this, a saturated neon colour starts to read as white, and only
 * the innermost tube may ever be white.
 */
export const MAX_COLOUR_LIGHTNESS = 70

/**
 * Hue for a spot on the spectrum (0 = bass … 1 = treble): hot pink for the
 * bass, through violet and blue to cyan, and neon mint for the treble.
 */
export function frequencyHue(pos: number): number {
  return 330 - 175 * pos
}

/**
 * Tube colour as an `hsl()` string. Two hue sources are blended by
 * `variety`: the age ramp of the reference (pink near the crater, cooling
 * through purple and blue to teal with depth), and the frequency at that
 * spot of the tube (frequencyHue). Tempo shifts the result colder or hotter;
 * `tint` adds per-tube variation. `light` sets the brightness.
 *
 * `white` (0..1) is only for the innermost tube, which burns toward white.
 * With `white` = 0 the colour stays fully saturated and never brighter than
 * MAX_COLOUR_LIGHTNESS, so no other tube can look white however brightly it
 * is lit.
 */
/** The hue tubeColor uses (degrees, unwrapped), without lightness or saturation. */
export function tubeHue(temperature: number, depth: number, pos: number, variety: number): number {
  const ageHue = 320 - 135 * depth + (pos - 0.5) * 36
  return ageHue + (frequencyHue(pos) - ageHue) * variety + (temperature - 0.5) * 110
}

export function tubeColor(
  temperature: number,
  depth: number,
  pos: number,
  tint: number,
  light: number,
  white: number,
  variety = 0,
): string {
  const hue = tubeHue(temperature, depth, pos, variety) + tint
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
