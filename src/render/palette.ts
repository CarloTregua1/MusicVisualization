function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * One colour per term rank, shared by the formula, epicycles and spectrum.
 * Hues step by the golden angle so neighbouring ranks stay distinct.
 */
export const TERM_COLORS: readonly string[] = Array.from({ length: 64 }, (_, i) =>
  hslToHex((190 + i * 137.508) % 360, 0.85, 0.66),
)

export const termColor = (i: number): string => TERM_COLORS[i % TERM_COLORS.length]
