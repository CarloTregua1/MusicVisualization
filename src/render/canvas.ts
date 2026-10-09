/** Theme colours for canvas drawing, read from CSS custom properties. */
export interface CanvasTheme {
  bg: string
  grid: string
  text: string
  real: string
  approx: string
}

export function readTheme(el: Element): CanvasTheme {
  const s = getComputedStyle(el)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return { bg: v('--panel'), grid: v('--grid'), text: v('--muted'), real: v('--real'), approx: v('--approx') }
}

/** Clears the canvas and returns its size in device pixels plus the pixel ratio. */
export function begin(ctx: CanvasRenderingContext2D, theme: CanvasTheme) {
  const { width, height } = ctx.canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, width, height)
  return { width, height, dpr: window.devicePixelRatio || 1 }
}
