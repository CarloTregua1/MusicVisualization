import { useCallback, useMemo, useRef, type RefCallback } from 'react'

export interface CanvasHandle {
  /** The mounted canvas, read by the render loop. */
  el: { current: HTMLCanvasElement | null }
  /** Pass as `ref`. Keeps the backing store sized to the CSS box × devicePixelRatio. */
  attach: RefCallback<HTMLCanvasElement>
}

/**
 * `maxDpr` caps the pixel ratio, and `maxPixels` the total backing-store size,
 * for full-screen, fill-rate-heavy canvases.
 */
export function useCanvas(maxDpr = Infinity, maxPixels = Infinity): CanvasHandle {
  const el = useRef<HTMLCanvasElement | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const attach = useCallback((canvas: HTMLCanvasElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    el.current = canvas
    if (!canvas) return
    const resize = () => {
      const area = Math.max(1, canvas.clientWidth * canvas.clientHeight)
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1, Math.sqrt(maxPixels / area))
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
    }
    resize()
    observer.current = new ResizeObserver(resize)
    observer.current.observe(canvas)
  }, [maxDpr, maxPixels])
  return useMemo(() => ({ el, attach }), [attach])
}
