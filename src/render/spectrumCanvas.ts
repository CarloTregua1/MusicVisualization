import type { Term } from '../types'
import { begin, type CanvasTheme } from './canvas'
import { noteName } from './notes'
import { termColor } from './palette'

const F_MIN = 20
const DB_MIN = -100

/** FFT magnitude (dBFS, log-frequency axis) with the chosen peaks highlighted. */
export function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  spectrum: Float64Array,
  sampleRate: number,
  terms: readonly Term[],
  showNotes: boolean,
  theme: CanvasTheme,
) {
  const { width, height, dpr } = begin(ctx, theme)
  const nyquist = sampleRate / 2
  const binHz = nyquist / (spectrum.length - 1)
  const logMin = Math.log(F_MIN)
  const logSpan = Math.log(nyquist) - logMin
  const xOf = (f: number) => ((Math.log(Math.max(f, F_MIN)) - logMin) / logSpan) * width
  const top = 18 * dpr
  const yOf = (amp: number) => {
    const db = Math.max(DB_MIN, 20 * Math.log10(amp + 1e-12))
    return top + (db / DB_MIN) * (height - top)
  }

  // Frequency grid.
  ctx.font = `${10 * dpr}px ui-monospace, monospace`
  ctx.lineWidth = dpr
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    if (f >= nyquist) break
    const x = xOf(f)
    ctx.strokeStyle = theme.grid
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, height)
    ctx.stroke()
    ctx.fillStyle = theme.text
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3 * dpr, height - 4 * dpr)
  }

  // Bars: max magnitude of the bins falling in each pixel column.
  ctx.fillStyle = theme.real
  ctx.globalAlpha = 0.55
  const cols = Math.ceil(width / dpr)
  let bin = 1
  for (let c = 0; c < cols; c++) {
    const fHi = Math.exp(logMin + ((c + 1) / cols) * logSpan)
    let m = 0
    let touched = false
    while (bin < spectrum.length && bin * binHz < fHi) {
      m = Math.max(m, spectrum[bin++])
      touched = true
    }
    if (!touched) {
      // Columns narrower than a bin (low frequencies): sample the nearest bin.
      const f = Math.exp(logMin + ((c + 0.5) / cols) * logSpan)
      m = spectrum[Math.min(spectrum.length - 1, Math.round(f / binHz))]
    }
    const y = yOf(m)
    ctx.fillRect(c * dpr, y, dpr, height - y)
  }
  ctx.globalAlpha = 1

  terms.forEach((t, i) => {
    const x = xOf(t.freq)
    const y = yOf(t.amp)
    ctx.strokeStyle = termColor(i)
    ctx.fillStyle = termColor(i)
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, height)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2)
    ctx.fill()
    if (showNotes && i < 8) ctx.fillText(noteName(t.freq), x + 5 * dpr, Math.max(top, y - 6 * dpr))
  })
}
