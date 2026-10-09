import { useEffect, useRef, useState, type RefObject } from 'react'
import { SKINS, type SkinName } from '../render/dancerSkins'
import { LFO_HZ_MAX, LFO_HZ_MIN, LFO_LENGTHS, LFO_SHAPES, TOGGLE_TARGETS, isToggle, type Lfo, type LfoTarget } from '../render/lfo'
import { PARAM_SPECS, PRESETS, type TunnelParams } from '../render/tunnelParams'

interface Props {
  params: TunnelParams
  /** The parameters as last drawn, LFOs applied. */
  live: RefObject<TunnelParams>
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
export function TuningPanel({ params, live, fps, onChange, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const body = useRef<HTMLDivElement>(null)

  // Live markers on the sliders an LFO is moving, set straight on the DOM each
  // frame so the panel doesn't re-render at 60 fps.
  useEffect(() => {
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const values = live.current
      body.current?.querySelectorAll<HTMLElement>('[data-lfo-key]').forEach((el) => {
        const spec = PARAM_SPECS.find((s) => s.key === el.dataset.lfoKey)
        if (!spec || !values) return
        el.style.setProperty('--live', String((values[spec.key] - spec.min) / (spec.max - spec.min)))
      })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [live])

  const modulated = new Set<LfoTarget>(params.lfos.filter((l) => l.on && l.depth > 0).map((l) => l.target))
  const setLfo = (i: number, change: Partial<Lfo>) =>
    onChange({ ...params, lfos: params.lfos.map((l, j) => (j === i ? { ...l, ...change } : l)) })

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
      <div className="tune-body" ref={body}>
        <section>
          <h3>LFO</h3>
          {params.lfos.map((lfo, i) => (
            <div key={i} className={`lfo ${lfo.on ? 'on' : ''}`}>
              <div className="lfo-head">
                <button className="lfo-toggle" aria-pressed={lfo.on} onClick={() => setLfo(i, { on: !lfo.on })} aria-label={`LFO ${i + 1} on`}>
                  {i + 1}
                </button>
                <select
                  className="tune-select"
                  value={lfo.target}
                  onChange={(e) => setLfo(i, { target: e.target.value as LfoTarget })}
                  aria-label={`LFO ${i + 1} target`}
                >
                  {groups.map((group) => (
                    <optgroup key={group} label={group}>
                      {[...TOGGLE_TARGETS, ...PARAM_SPECS].filter((s) => s.group === group).map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {lfo.on && (
                <>
                  <div className="seg tune-seg lfo-shapes" role="group" aria-label={`LFO ${i + 1} shape`}>
                    {LFO_SHAPES.map(({ shape, symbol, label }) => (
                      <button key={shape} title={label} aria-label={label} aria-pressed={lfo.shape === shape} onClick={() => setLfo(i, { shape })}>
                        {symbol}
                      </button>
                    ))}
                  </div>
                  <div className="lfo-rate">
                    <div className="seg tune-seg" role="group" aria-label={`LFO ${i + 1} rate`}>
                      <button aria-pressed={lfo.sync} onClick={() => setLfo(i, { sync: true })}>
                        Sync
                      </button>
                      <button aria-pressed={!lfo.sync} onClick={() => setLfo(i, { sync: false })}>
                        Hz
                      </button>
                    </div>
                    {lfo.sync ? (
                      <select
                        className="tune-select"
                        value={lfo.beats}
                        onChange={(e) => setLfo(i, { beats: Number(e.target.value) })}
                        aria-label={`LFO ${i + 1} length`}
                      >
                        {LFO_LENGTHS.map(({ beats, label }) => (
                          <option key={beats} value={beats}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <label className="lfo-hz">
                        <b>{lfo.hz.toFixed(2)} Hz</b>
                        {/* Log scale: equal steps from very slow sweeps to fast wobbles. */}
                        <input
                          type="range"
                          min={Math.log(LFO_HZ_MIN)}
                          max={Math.log(LFO_HZ_MAX)}
                          step={0.01}
                          value={Math.log(lfo.hz)}
                          onChange={(e) => setLfo(i, { hz: Math.exp(Number(e.target.value)) })}
                          aria-label={`LFO ${i + 1} rate in hertz`}
                        />
                      </label>
                    )}
                  </div>
                  <label className="tune-row">
                    {isToggle(lfo.target) ? (
                      <span>
                        {params[lfo.target] ? 'Off' : 'On'} for
                        <b>{Math.round(lfo.depth * 100)}% of the cycle</b>
                      </span>
                    ) : (
                      <span>
                        Depth
                        <b>{lfo.depth.toFixed(2)}</b>
                      </span>
                    )}
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={lfo.depth}
                      onChange={(e) => setLfo(i, { depth: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}
            </div>
          ))}
        </section>
        {groups.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            {group === 'Flow' && (
              <div className="tune-row">
                <span>Direction</span>
                <div className="seg tune-seg" role="group" aria-label="Direction">
                  <button aria-pressed={!params.inward} onClick={() => onChange({ ...params, inward: false })}>
                    Outward
                  </button>
                  <button aria-pressed={params.inward} onClick={() => onChange({ ...params, inward: true })}>
                    Inward
                  </button>
                </div>
              </div>
            )}
            {group === 'Flow' && (
              <div className="tune-row">
                <span>Tube timing</span>
                <div className="seg tune-seg" role="group" aria-label="Tube timing">
                  <button aria-pressed={!params.followSong} onClick={() => onChange({ ...params, followSong: false })}>
                    Fixed rate
                  </button>
                  <button aria-pressed={params.followSong} onClick={() => onChange({ ...params, followSong: true })}>
                    Follow the song
                  </button>
                </div>
              </div>
            )}
            {group === 'Colour' && (
              <div className="tune-row">
                <span>Palette drift</span>
                <div className="seg tune-seg" role="group" aria-label="Palette drift">
                  <button aria-pressed={params.colourDrift} onClick={() => onChange({ ...params, colourDrift: true })}>
                    On
                  </button>
                  <button aria-pressed={!params.colourDrift} onClick={() => onChange({ ...params, colourDrift: false })}>
                    Off
                  </button>
                </div>
              </div>
            )}
            {group === 'Dancer' && (
              <div className="tune-row">
                <span>
                  <em>
                    Dancer
                    {modulated.has('dancerOn') && <i className="lfo-tag">LFO</i>}
                  </em>
                </span>
                <div className="seg tune-seg" role="group" aria-label="Dancer">
                  <button aria-pressed={params.dancerOn} onClick={() => onChange({ ...params, dancerOn: true })}>
                    On
                  </button>
                  <button aria-pressed={!params.dancerOn} onClick={() => onChange({ ...params, dancerOn: false })}>
                    Off
                  </button>
                </div>
              </div>
            )}
            {group === 'Dancer' && (
              <label className="tune-row">
                <span>Skin</span>
                <select
                  className="tune-select"
                  value={params.dancerSkin}
                  onChange={(e) => onChange({ ...params, dancerSkin: e.target.value as SkinName })}
                >
                  {SKINS.map((sk) => (
                    <option key={sk} value={sk}>
                      {sk[0].toUpperCase() + sk.slice(1)}
                      {sk === 'robot' || sk === 'adventurer' ? ' (Kenney, CC0)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {group === 'Dancer' && (
              <div className="tune-row">
                <span>Style</span>
                <div className="seg tune-seg" role="group" aria-label="Dance style">
                  {(['auto', 'energetic', 'smooth', 'robotic'] as const).map((st) => (
                    <button key={st} aria-pressed={params.dancerStyle === st} onClick={() => onChange({ ...params, dancerStyle: st })}>
                      {st[0].toUpperCase() + st.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {PARAM_SPECS.filter((s) => s.group === group)
              // Show only the timing control that applies to the current mode.
              .filter((s) => (s.key === 'songSensitivity' ? params.followSong : s.key === 'tubesPerSecond' ? !params.followSong : true))
              .map((spec) => (
              <label key={spec.key} className={`tune-row ${modulated.has(spec.key) ? 'lfo-target' : ''}`} data-lfo-key={modulated.has(spec.key) ? spec.key : undefined}>
                <span>
                  <em>
                    {spec.label}
                    {modulated.has(spec.key) && <i className="lfo-tag">LFO</i>}
                  </em>
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
