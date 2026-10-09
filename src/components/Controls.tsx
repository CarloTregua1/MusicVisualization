import { WINDOW_SIZES, type Settings } from '../settings'

interface Props {
  settings: Settings
  sampleRate: number
  onChange: (patch: Partial<Settings>) => void
}

export function Controls({ settings, sampleRate, onChange }: Props) {
  return (
    <div className="controls">
      <label className="control grow">
        <span>
          Terms <b>N = {settings.n}</b>
        </span>
        <input
          type="range"
          min={1}
          max={64}
          value={settings.n}
          onChange={(e) => onChange({ n: Number(e.target.value) })}
        />
      </label>
      <label className="control">
        <span>Window</span>
        <select value={settings.size} onChange={(e) => onChange({ size: Number(e.target.value) })}>
          {WINDOW_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} · {((s / sampleRate) * 1000).toFixed(0)} ms
            </option>
          ))}
        </select>
      </label>
      <label className="control check">
        <input type="checkbox" checked={settings.smoothing} onChange={(e) => onChange({ smoothing: e.target.checked })} />
        <span>Smoothing</span>
      </label>
      <label className="control check">
        <input type="checkbox" checked={settings.notes} onChange={(e) => onChange({ notes: e.target.checked })} />
        <span>Note names</span>
      </label>
    </div>
  )
}
