import type { RefCallback } from 'react'

interface Props {
  canvasRef: RefCallback<HTMLCanvasElement>
  error: string
}

export function WaveformPanel({ canvasRef, error }: Props) {
  return (
    <section className="panel" aria-label="Waveform">
      <header className="panel-head">
        <h2>Waveform</h2>
        <span className="legend">
          <i className="sw real" /> audio <i className="sw approx" /> N-term expression
        </span>
        <span className="stat">RMS error {error}</span>
      </header>
      <canvas ref={canvasRef} className="canvas wave" />
    </section>
  )
}
