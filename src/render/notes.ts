const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

/** Closest equal-tempered note to `freq` (A4 = 440 Hz), e.g. "A4 +3¢". */
export function noteName(freq: number): string {
  if (!(freq > 0)) return ''
  const midi = 69 + 12 * Math.log2(freq / 440)
  const nearest = Math.round(midi)
  const cents = Math.round((midi - nearest) * 100)
  const name = NAMES[((nearest % 12) + 12) % 12] + (Math.floor(nearest / 12) - 1)
  return cents === 0 ? name : `${name} ${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`
}

/** Note name as KaTeX, without cents, e.g. "\\mathrm{C}\\sharp 4". */
export function noteLatex(freq: number): string {
  if (!(freq > 0)) return ''
  const nearest = Math.round(69 + 12 * Math.log2(freq / 440))
  const name = NAMES[((nearest % 12) + 12) % 12]
  const letter = name[0]
  return `\\mathrm{${letter}}${name.length > 1 ? '\\sharp' : ''}${Math.floor(nearest / 12) - 1}`
}
