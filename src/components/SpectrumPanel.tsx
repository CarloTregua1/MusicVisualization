import type { RefCallback } from 'react'

export function SpectrumPanel({ canvasRef }: { canvasRef: RefCallback<HTMLCanvasElement> }) {
  return (
    <section className="panel" aria-label="Spectrum">
      <header className="panel-head">
        <h2>Spectrum</h2>
        <span className="legend muted">magnitude, dBFS · chosen peaks highlighted</span>
      </header>
      <canvas ref={canvasRef} className="canvas small" />
    </section>
  )
}
