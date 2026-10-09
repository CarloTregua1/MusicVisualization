import { useEffect, useRef, useState } from 'react'
import type { LoadedAudio } from '../audio/loader'
import type { Player } from '../audio/player'
import { Analyzer } from '../dsp/analyze'
import { BandMapper } from '../dsp/bands'
import { OnsetDetector } from '../dsp/onset'
import { rms } from '../dsp/resynth'
import { tempoAt, type TempoTrack } from '../dsp/tempo'
import { Backdrop } from '../render/backdrop'
import { bpmToTemperature, neon } from '../render/neon'
import { FiberTunnel, type FiberInput } from '../render/fiberTunnel'
import { Transport } from './Transport'
import { useCanvas } from './useCanvas'

const FFT_SIZE = 2048
const HUD_IDLE_MS = 2500

interface Props {
  player: Player
  audio: LoadedAudio
  tempo: TempoTrack | null
  tempoProgress: number
  playing: boolean
  time: number
  onSeek: (t: number) => void
  onExit: () => void
}

export function VisualizerView({ player, audio, tempo, tempoProgress, playing, time, onSeek, onExit }: Props) {
  const root = useRef<HTMLDivElement>(null)
  // Pixel budget keeps big full-screen displays smooth; bloom hides the softness.
  const canvas = useCanvas(1.5, 2.2e6)
  const tempoRef = useRef(tempo)
  const [bpm, setBpm] = useState<number>(NaN)
  const [temperature, setTemperature] = useState(0.5)
  const [hudVisible, setHudVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    tempoRef.current = tempo
  }, [tempo])

  // Render loop.
  useEffect(() => {
    const { mono, sampleRate } = audio
    const analyzer = new Analyzer(FFT_SIZE)
    const mapper = new BandMapper(FFT_SIZE, sampleRate)
    const tunnel = new FiberTunnel(mapper.count)
    const backdrop = new Backdrop()
    // Sensitive enough to catch softer events (hats, plucks), up to ~5 strings a second.
    const onsets = new OnsetDetector(mapper.count, 0.18, 1.7, 8)
    const input: FiberInput = { bands: mapper.levels, level: 0, temperature: 0.5 }
    let beat = 0
    const win = new Float32Array(FFT_SIZE)
    let temp = 0.5
    let shownBpm = 120
    let speed = 1
    let last = performance.now()
    let lastHud = 0
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
      const sounding = player.playing && inside
      beat = Math.max(onset, beat * Math.exp(-realDt * 6))

      const track = tempoRef.current
      const bpmNow = track ? tempoAt(track, t) : NaN
      if (!Number.isNaN(bpmNow)) shownBpm = bpmNow
      // Temperature glides (~1.5 s) so tempo changes read as a colour sweep.
      temp += (bpmToTemperature(shownBpm) - temp) * (1 - Math.exp(-realDt / 1.5))
      input.temperature = temp
      input.level = level

      // A slow, calm drift; faster music drifts a little faster.
      const lifetime = Math.min(7, Math.max(4, 5.5 * (120 / shownBpm)))
      tunnel.update(dt, input, sounding, onset, lifetime)
      backdrop.draw(ctx, dt, { temperature: temp, level: player.playing ? level : 0, beat })
      tunnel.render(ctx)

      if (now - lastHud > 250) {
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

  const showHud = hudVisible || !playing
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
        <button className="glass-btn" onClick={toggleFullscreen}>
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
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
