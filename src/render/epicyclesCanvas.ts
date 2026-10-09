import type { Term } from '../types'
import { begin, type CanvasTheme } from './canvas'
import { termColor } from './palette'

/** Ring buffer of recent tip heights (signal values), newest first when read. */
export class Trace {
  readonly data: Float32Array
  head = 0
  filled = 0
  constructor(length = 900) {
    this.data = new Float32Array(length)
  }
  push(v: number) {
    this.head = (this.head + 1) % this.data.length
    this.data[this.head] = v
    this.filled = Math.min(this.filled + 1, this.data.length)
  }
  clear() {
    this.filled = 0
  }
}

/** Evaluates the epicycle chain at local time τ (seconds from t₀); returns the tip height. */
export function chainValue(terms: readonly Term[], tau: number): number {
  let y = 0
  for (const t of terms) y += t.amp * Math.sin(2 * Math.PI * t.freq * tau + t.phase)
  return y
}

/**
 * Circles chained tip to tail (radius = amp, angle = 2πf·τ + φ), largest
 * first. The tip's height is the expression's value; its history is drawn
 * to the right as a scrolling trace.
 */
export function drawEpicycles(
  ctx: CanvasRenderingContext2D,
  terms: readonly Term[],
  tau: number,
  trace: Trace,
  theme: CanvasTheme,
) {
  const { width, height, dpr } = begin(ctx, theme)
  const cx = Math.min(width * 0.3, height * 0.55)
  const cy = height / 2
  let total = 0
  for (const t of terms) total += t.amp
  const scale = total > 0 ? (Math.min(cx, height / 2) * 0.88) / total : 0
  const traceX = cx * 2 + 16 * dpr

  let x = cx
  let y = cy
  ctx.lineWidth = dpr
  terms.forEach((t, i) => {
    const r = t.amp * scale
    const theta = 2 * Math.PI * t.freq * tau + t.phase
    const nx = x + r * Math.cos(theta)
    const ny = y - r * Math.sin(theta)
    ctx.strokeStyle = termColor(i)
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 0.95
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(nx, ny)
    ctx.stroke()
    x = nx
    y = ny
  })
  ctx.globalAlpha = 1

  // Axis for the trace, connector from the tip, then the trace itself.
  ctx.strokeStyle = theme.grid
  ctx.beginPath()
  ctx.moveTo(traceX, cy)
  ctx.lineTo(width, cy)
  ctx.stroke()
  ctx.setLineDash([3 * dpr, 4 * dpr])
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(traceX, y)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.strokeStyle = theme.approx
  ctx.lineWidth = 1.5 * dpr
  ctx.beginPath()
  const { data, head, filled } = trace
  const step = dpr * 1.25
  for (let i = 0; i < filled; i++) {
    const px = traceX + i * step
    if (px > width) break
    const v = data[(head - i + data.length) % data.length]
    const py = cy - v * scale
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()

  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2)
  ctx.fill()
}
