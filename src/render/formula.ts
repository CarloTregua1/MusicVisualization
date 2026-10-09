import type { Term } from '../types'
import { noteLatex } from './notes'
import { termColor } from './palette'

const TERMS_PER_LINE = 3

const fmtPhase = (p: number) => p.toFixed(2)

function signed(value: string, first: boolean): string {
  const neg = value.startsWith('-')
  const abs = neg ? value.slice(1) : value
  if (first) return neg ? `-${abs}` : abs
  return neg ? `- ${abs}` : `+ ${abs}`
}

/** One term as LaTeX, without a leading sign. */
function termLatex({ freq, amp, phase }: Term, notes: boolean): string {
  const ph = fmtPhase(phase)
  const phasePart = ph.startsWith('-') ? `- ${ph.slice(1)}` : `+ ${ph}`
  const f = notes ? `\\underset{${noteLatex(freq)}}{${freq.toFixed(1)}}` : freq.toFixed(1)
  return `${amp.toFixed(3)}\\sin\\!\\left(2\\pi\\cdot ${f}\\,(t-t_0) ${phasePart}\\right)`
}

/**
 * Builds the coloured KaTeX expression x(t) ≈ Σ Aₖ sin(2π fₖ (t − t₀) + φₖ),
 * broken over several aligned lines so long sums stay readable.
 */
export function termsToLatex(
  terms: readonly Term[],
  { colored = true, notes = false }: { colored?: boolean; notes?: boolean } = {},
): string {
  if (terms.length === 0) return 'x(t) \\approx 0'
  const lines: string[] = []
  let line = ''
  terms.forEach((t, i) => {
    const body = signed(termLatex(t, notes), i === 0)
    const piece = colored ? `\\textcolor{${termColor(i)}}{${body}}` : body
    line += (line ? ' ' : '') + piece
    if ((i + 1) % TERMS_PER_LINE === 0 || i === terms.length - 1) {
      lines.push(line)
      line = ''
    }
  })
  return `\\begin{aligned} x(t) \\approx\\; & ${lines.join(' \\\\ & ')} \\end{aligned}`
}

/** Plain-text version, e.g. for copying. */
export function termsToText(terms: readonly Term[]): string {
  if (terms.length === 0) return 'x(t) ≈ 0'
  return (
    'x(t) ≈ ' +
    terms
      .map((t, i) => {
        const ph = fmtPhase(t.phase)
        const body = `${t.amp.toFixed(3)}·sin(2π·${t.freq.toFixed(1)}·(t−t₀) ${ph.startsWith('-') ? '− ' + ph.slice(1) : '+ ' + ph})`
        return i === 0 ? body : `+ ${body}`
      })
      .join(' ')
  )
}
