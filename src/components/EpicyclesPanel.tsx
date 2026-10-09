import type { RefCallback } from 'react'

// Slider works in log₁₀ of the slowdown factor: 1/20× … 1/5000×.
const MIN = Math.log10(20)
const MAX = Math.log10(5000)

interface Props {
  canvasRef: RefCallback<HTMLCanvasElement>
  timeScale: number
  onTimeScale: (s: number) => void
}

export function EpicyclesPanel({ canvasRef, timeScale, onTimeScale }: Props) {
  const slow = 1 / timeScale
  return (
    <section className="panel" aria-label="Epicycles">
      <header className="panel-head">
        <h2>Epicycles</h2>
        <label className="control inline">
          <span>
            speed <b>1/{Math.round(slow)}×</b>
          </span>
          <input
            type="range"
            min={MIN}
            max={MAX}
            step={0.01}
            value={MAX + MIN - Math.log10(slow)}
            onChange={(e) => onTimeScale(1 / 10 ** (MAX + MIN - Number(e.target.value)))}
            aria-label="Epicycle time scale"
          />
        </label>
      </header>
      <canvas ref={canvasRef} className="canvas small" />
    </section>
  )
}
