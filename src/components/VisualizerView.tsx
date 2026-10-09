import { useEffect, useRef, useState } from 'react'
import type { LoadedAudio } from '../audio/loader'
import type { Player } from '../audio/player'
import { Analyzer } from '../dsp/analyze'
import { BandMapper } from '../dsp/bands'
import { OnsetDetector } from '../dsp/onset'
import { rms } from '../dsp/resynth'
import { tempoAt, type TempoTrack } from '../dsp/tempo'
import { beatPhase } from '../dsp/beats'
import { Backdrop } from '../render/backdrop'
import { Dancer, drawDancer } from '../render/dancer'
import { bpmToTemperature, neon } from '../render/neon'
import { FiberTunnel, type FiberInput } from '../render/fiberTunnel'
import { MEASURED_PARAMS, type TunnelParams } from '../render/tunnelParams'
import { Transport } from './Transport'
import { TuningPanel } from './TuningPanel'
import { useCanvas } from './useCanvas'

const FFT_SIZE = 2048
const HUD_IDLE_MS = 2500
const PARAMS_KEY = 'audioToMath.tunnelParams'

/** Tuning is a per-viewer convenience: remembered in this browser if storage works. */
function loadParams(): TunnelParams {
  try {
    const saved = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? 'null')
    if (saved && typeof saved === 'object') return { ...MEASURED_PARAMS, ...saved }
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...MEASURED_PARAMS }
}

function saveParams(params: TunnelParams) {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(params))
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

interface Props {
  player: Player
  audio: LoadedAudio
  tempo: TempoTrack | null
  /** Beat times (s), once the beat tracker has run. */
  beats: Float32Array | null
  /** Which beat starts a bar, and drop times (s), once known. */
  structure: { downbeat: number; drops: Float32Array } | null
  tempoProgress: number
  playing: boolean
  time: number
  onSeek: (t: number) => void
  onExit: () => void
}

export function VisualizerView({ player, audio, tempo, beats, structure, tempoProgress, playing, time, onSeek, onExit }: Props) {
  const root = useRef<HTMLDivElement>(null)
  // Pixel budget keeps big full-screen displays smooth; bloom hides the softness.
  const canvas = useCanvas(1.5, 1.6e6)
  const tempoRef = useRef(tempo)
  const [bpm, setBpm] = useState<number>(NaN)
  const [temperature, setTemperature] = useState(0.5)
  const [hudVisible, setHudVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [tuning, setTuning] = useState(false)
  const [params, setParams] = useState<TunnelParams>(loadParams)
  const [fps, setFps] = useState(60)
  const paramsRef = useRef(params)

  const beatsRef = useRef(beats)
  const structureRef = useRef(structure)

  useEffect(() => {
    tempoRef.current = tempo
  }, [tempo])

  useEffect(() => {
    beatsRef.current = beats
  }, [beats])

  useEffect(() => {
    structureRef.current = structure
  }, [structure])

  useEffect(() => {
    paramsRef.current = params
    saveParams(params)
  }, [params])

  // Render loop.
  useEffect(() => {
    const { mono, sampleRate } = audio
    const analyzer = new Analyzer(FFT_SIZE)
    const mapper = new BandMapper(FFT_SIZE, sampleRate)
    const tunnel = new FiberTunnel(mapper.count)
    const dancer = new Dancer()
    let lastT = 0
    const backdrop = new Backdrop()
    // Sensitive enough to catch softer events (hats, plucks), up to ~5 strings a second.
    const onsets = new OnsetDetector(mapper.count, 0.18, 1.7, 8)
    // Follow-the-song tube timing: a far more sensitive detector, retuned each
    // frame from the sensitivity slider; a new tube is born on each event.
    const tubeEvents = new OnsetDetector(mapper.count, 0.03, 2, 6)
    const input: FiberInput = { bands: mapper.levels, level: 0, temperature: 0.5 }
    let beat = 0
    const win = new Float32Array(FFT_SIZE)
    let temp = 0.5
    let shownBpm = 120
    let speed = 1
    let last = performance.now()
    let lastHud = 0
    let frames = 0
    let raf = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const ctx = canvas.el.current?.getContext('2d')
      if (!ctx) return
      const realDt = Math.min(0.1, (now - last) / 1000)
      last = now
      // Ease to a slow drift while paused instead of freezing.
      speed += ((player.playing ? 1 : 0.25) - speed) * (1 - Math.exp(-realDt * 4))
      const dt = realDt * speed

      const t = player.currentTime()
      const center = Math.round(t * sampleRate)
      analyzer.analyze(mono, sampleRate, center, 1)
      mapper.map(analyzer.spectrum)

      const start = center - FFT_SIZE / 2
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = start + i
        win[i] = idx >= 0 && idx < mono.length ? mono[idx] : 0
      }
      const level = Math.min(1, Math.max(0, (20 * Math.log10(rms(win) + 1e-9) + 50) / 44))

      // While playing, a white tube is born 15 times a second and develops from
      // the sound; its brightness (the scene's light) follows the loudness, so
      // silence goes dark. Near the end of the file the window is cut off by
      // zero padding, which would look like a fake onset.
      const inside = center + FFT_SIZE / 2 <= mono.length
      const onset = player.playing && inside ? onsets.update(mapper.levels, t) : 0
      const sens = paramsRef.current.songSensitivity
      // Exponential mapping: sensitivity 0 needs big jumps (strong hits only);
      // 1 accepts changes well below the recent average (every small change).
      // On the reference song this spans ~6 to ~14 tubes per second.
      tubeEvents.ratio = 2.6 * Math.pow(0.12, sens)
      tubeEvents.floor = 10 * Math.pow(0.05, sens)
      const songEvent = player.playing && inside && tubeEvents.update(mapper.levels, t) > 0
      const sounding = player.playing && inside
      beat = Math.max(onset, beat * Math.exp(-realDt * 6))

      const track = tempoRef.current
      const bpmNow = track ? tempoAt(track, t) : NaN
      if (!Number.isNaN(bpmNow)) shownBpm = bpmNow
      // Temperature glides (~1.5 s) so tempo changes read as a colour sweep.
      temp += (bpmToTemperature(shownBpm) - temp) * (1 - Math.exp(-realDt / 1.5))
      input.temperature = temp
      input.level = level

      // Rings spread over the tuned time; faster music spreads a little faster.
      tunnel.params = paramsRef.current
      const spread = paramsRef.current.spreadSeconds
      const lifetime = spread * Math.min(1.3, Math.max(0.75, 120 / shownBpm))
      tunnel.update(dt, input, sounding, onset, lifetime, songEvent)
      frames++
      backdrop.draw(ctx, dt, { temperature: temp, level: player.playing ? level : 0, beat })
      tunnel.render(ctx)

      // The dancer, standing in the crater, moving on the tracked beats (or on
      // the BPM until the beat tracker has finished).
      const pr = paramsRef.current
      const levels = mapper.levels
      const n = levels.length
      const third = Math.floor(n / 3)
      let lo = 0
      let hi = 0
      let sum = 0
      let weighted = 0
      for (let i = 0; i < n; i++) {
        if (i < third) lo += levels[i]
        else if (i >= 2 * third) hi += levels[i]
        sum += levels[i]
        weighted += levels[i] * i
      }
      const beatNow = beatsRef.current
        ? beatPhase(beatsRef.current, t)
        : (() => {
            const x = (t * shownBpm) / 60
            return { index: Math.floor(x), phase: x - Math.floor(x), period: 60 / shownBpm }
          })()
      // Phrase the dance in bars: beat 0 of the grid is the song's first downbeat.
      const song = structureRef.current
      const barBeat = song ? { ...beatNow, index: beatNow.index - song.downbeat } : beatNow
      // A drop happened if we just played across one (not on seeks).
      let drop = false
      if (song && t > lastT && t - lastT < 0.25) for (const d of song.drops) if (d > lastT && d <= t) drop = true
      lastT = t
      dancer.update(
        dt,
        {
          beat: barBeat,
          drop,
          light: tunnel.stage.light,
          level: player.playing ? level : 0,
          onset,
          bass: lo / third,
          treble: hi / (n - 2 * third),
          brightness: sum > 1e-6 ? weighted / sum / (n - 1) : 0,
        },
        { energy: pr.dancerEnergy },
      )
      if (pr.dancerOn) {
        const st = tunnel.stage
        drawDancer(
          ctx,
          dancer,
          { x: st.x, y: st.y + st.rimRadius * 0.15, height: pr.dancerSize * st.rimRadius * 2, light: st.light, roll: st.roll, rollX: st.rollX, rollY: st.rollY },
          temp,
          pr.colourVariety,
          pr.dancerThickness,
        )
      }

      if (now - lastHud > 500) {
        setFps((frames * 1000) / (now - lastHud))
        frames = 0
        lastHud = now
        setBpm(track && !Number.isNaN(bpmNow) ? bpmNow : NaN)
        setTemperature(temp)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audio, player, canvas])

  // HUD auto-hides while playing and the pointer is idle.
  useEffect(() => {
    let timer = 0
    const wake = () => {
      setHudVisible(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setHudVisible(false), HUD_IDLE_MS)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === root.current)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyF' && !(e.target as HTMLElement).closest('input, select, textarea')) toggleFullscreen()
    }
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.current?.requestFullscreen()
  }

  // The HUD stays up while tuning, so the sliders don't fade away mid-adjustment.
  const showHud = hudVisible || !playing || tuning
  return (
    <div ref={root} className={`viz ${showHud ? '' : 'hud-hidden'}`}>
      <canvas ref={canvas.attach} className="viz-canvas" />
      <div className="viz-top hud">
        <button className="glass-btn" onClick={onExit}>
          ← Math view
        </button>
        <div className="viz-title" title={audio.name}>
          {audio.name}
        </div>
        <button className="glass-btn" onClick={() => setTuning((v) => !v)} aria-pressed={tuning}>
          Tune
        </button>
        <button className="glass-btn" onClick={toggleFullscreen}>
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      {tuning && <TuningPanel params={params} fps={fps} onChange={setParams} onClose={() => setTuning(false)} />}
      <div className="viz-tempo hud">
        <div className="bpm">
          {tempo ? (Number.isNaN(bpm) ? '—' : Math.round(bpm)) : `${Math.round(tempoProgress * 100)}%`}
          <span>{tempo ? 'BPM' : 'reading tempo'}</span>
        </div>
        <div
          className="temp-bar"
          style={{
            background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((x) => neon(x, 0.5, 58)).join(', ')})`,
          }}
          aria-label={`Colour temperature ${Math.round(temperature * 100)}%`}
        >
          <i style={{ left: `${temperature * 100}%` }} />
        </div>
        <div className="temp-labels">
          <span>cold · slow</span>
          <span>hot · fast</span>
        </div>
      </div>
      <div className="viz-bottom hud">
        <Transport
          playing={playing}
          time={time}
          duration={player.duration}
          disabled={false}
          onToggle={() => player.toggle()}
          onSeek={onSeek}
        />
      </div>
    </div>
  )
}
