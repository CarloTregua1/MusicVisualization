import { useState } from 'react'
import { PARAM_SPECS, PRESETS, type TunnelParams } from '../render/tunnelParams'

interface Props {
  params: TunnelParams
  fps: number
  onChange: (params: TunnelParams) => void
  onClose: () => void
}

const groups = [...new Set(PARAM_SPECS.map((s) => s.group))]

function format(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)))
  return value.toFixed(decimals)
}

/** Live sliders for the tube look, with presets and a copy-to-clipboard of the values. */
export function TuningPanel({ params, fps, onChange, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const text = JSON.stringify(params, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy these settings:', text)
    }
  }

  return (
    <aside className="tune" aria-label="Tuning">
      <header className="tune-head">
        <h2>Tune</h2>
        <span className={`fps ${fps < 45 ? 'slow' : ''}`}>{Math.round(fps)} fps</span>
        <button className="glass-btn small" onClick={onClose} aria-label="Close tuning">
          ✕
        </button>
      </header>
      <div className="tune-presets">
        {Object.entries(PRESETS).map(([name, preset]) => (
          <button key={name} className="glass-btn small" onClick={() => onChange({ ...preset })}>
            {name}
          </button>
        ))}
        <button className="glass-btn small accent" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy settings'}
        </button>
      </div>
      <div className="tune-body">
        {groups.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            {PARAM_SPECS.filter((s) => s.group === group).map((spec) => (
              <label key={spec.key} className="tune-row">
                <span>
                  {spec.label}
                  <b>{format(params[spec.key], spec.step)}</b>
                </span>
                <input
                  type="range"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={params[spec.key]}
                  onChange={(e) => onChange({ ...params, [spec.key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}
