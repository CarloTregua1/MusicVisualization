import { begin, type CanvasTheme } from './canvas'

function trace(ctx: CanvasRenderingContext2D, data: ArrayLike<number>, width: number, mid: number, scale: number) {
  const n = data.length
  const dx = width / (n - 1)
  ctx.beginPath()
  ctx.moveTo(0, mid - data[0] * scale)
  for (let i = 1; i < n; i++) ctx.lineTo(i * dx, mid - data[i] * scale)
  ctx.stroke()
}

/** Real audio window vs its N-term reconstruction, sharing one vertical scale. */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  real: ArrayLike<number>,
  approx: ArrayLike<number>,
  theme: CanvasTheme,
) {
  const { width, height, dpr } = begin(ctx, theme)
  const mid = height / 2

  let peak = 0.05 // floor so near-silence doesn't get magnified into noise
  for (let i = 0; i < real.length; i++) peak = Math.max(peak, Math.abs(real[i]), Math.abs(approx[i]))
  const scale = (height * 0.45) / peak

  ctx.strokeStyle = theme.grid
  ctx.lineWidth = dpr
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(width, mid)
  ctx.moveTo(width / 2, 0)
  ctx.lineTo(width / 2, height)
  ctx.stroke()

  ctx.lineJoin = 'round'
  ctx.lineWidth = 1.5 * dpr
  ctx.strokeStyle = theme.real
  trace(ctx, real, width, mid, scale)
  ctx.lineWidth = 1.5 * dpr
  ctx.strokeStyle = theme.approx
  trace(ctx, approx, width, mid, scale)

  ctx.fillStyle = theme.text
  ctx.font = `${11 * dpr}px ui-monospace, monospace`
  ctx.fillText('t₀', width / 2 + 4 * dpr, height - 6 * dpr)
}
