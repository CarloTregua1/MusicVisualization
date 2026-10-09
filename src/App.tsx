import { useCallback, useEffect, useRef, useState } from 'react'
import { loadAudioFile, type LoadedAudio } from './audio/loader'
import { Player } from './audio/player'
import { Controls } from './components/Controls'
import { DropZone } from './components/DropZone'
import { EpicyclesPanel } from './components/EpicyclesPanel'
import { FormulaPanel } from './components/FormulaPanel'
import { HearMath, type ResynthState } from './components/HearMath'
import { SpectrumPanel } from './components/SpectrumPanel'
import { Transport } from './components/Transport'
import { useCanvas } from './components/useCanvas'
import { WaveformPanel } from './components/WaveformPanel'
import { Analyzer } from './dsp/analyze'
import { resynthesizeTrack, rms, rmsError, synthesize } from './dsp/resynth'
import { PeakTracker } from './dsp/smoothing'
import { readTheme } from './render/canvas'
import { chainValue, drawEpicycles, Trace } from './render/epicyclesCanvas'
import { termsToLatex } from './render/formula'
import { drawSpectrum } from './render/spectrumCanvas'
import { drawWaveform } from './render/waveformCanvas'
import type { Settings } from './settings'
import type { Term } from './types'

/** Formula, error and clock text refresh at ~15 fps; canvases run every frame. */
const TEXT_INTERVAL_MS = 1000 / 15

let sharedPlayer: Player | null = null
const getPlayer = () => (sharedPlayer ??= new Player())

const resynthKey = (s: Settings) => `${s.n}/${s.size}`

export default function App() {
  const player = getPlayer()
  const [audio, setAudio] = useState<LoadedAudio | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({ n: 10, size: 2048, smoothing: false, notes: false, timeScale: 1 / 500 })
  const [playing, setPlaying] = useState(false)
  const [ab, setAb] = useState<'original' | 'math'>('original')
  const [time, setTime] = useState(0)
  const [latex, setLatex] = useState<string | null>(null)
  const [rmsText, setRmsText] = useState('—')
  const [resynth, setResynth] = useState<ResynthState>({ status: 'idle' })

  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])
  const resynthJob = useRef(0)

  const waveRef = useCanvas()
  const specRef = useCanvas()
  const epiRef = useCanvas()

  useEffect(
    () =>
      player.subscribe(() => {
        setPlaying(player.playing)
        setAb(player.abState)
        setTime(player.position())
      }),
    [player],
  )

  const onFile = useCallback(
    async (file: File) => {
      setLoading(true)
      setError(null)
      try {
        const loaded = await loadAudioFile(file, player.ctx)
        resynthJob.current++
        setResynth({ status: 'idle' })
        player.load(loaded.buffer)
        setAudio(loaded)
      } catch {
        setError(`Couldn't decode “${file.name}”. Try another format.`)
      } finally {
        setLoading(false)
      }
    },
    [player],
  )

  const patchSettings = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [])

  // Keyboard: space toggles playback, ←/→ seek by 5 s.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input:not([type=range]):not([type=checkbox]), select, textarea')) return
      if (e.code === 'Space') {
        if (el.tagName === 'BUTTON') return
        e.preventDefault()
        player.toggle()
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        if (el.matches('input[type=range]')) return
        player.seek(player.position() + (e.code === 'ArrowLeft' ? -5 : 5))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])

  // The render loop: analysis at the playhead, then every canvas, every frame.
  useEffect(() => {
    if (!audio) return
    const { mono, sampleRate } = audio
    const analyzers = new Map<number, Analyzer>()
    const frames = new Map<number, { real: Float64Array; approx: Float64Array }>()
    const tracker = new PeakTracker()
    const trace = new Trace()
    const theme = readTheme(document.documentElement)
    let lastSize = 0
    let lastSmoothing = false
    let lastText = 0
    let lastNow = performance.now()
    let tau = 0
    let raf = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const s = settingsRef.current
      const dt = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now

      let analyzer = analyzers.get(s.size)
      if (!analyzer) analyzers.set(s.size, (analyzer = new Analyzer(s.size)))
      let frame = frames.get(s.size)
      if (!frame) frames.set(s.size, (frame = { real: new Float64Array(s.size), approx: new Float64Array(s.size) }))
      if (s.size !== lastSize || s.smoothing !== lastSmoothing) {
        tracker.reset()
        lastSize = s.size
        lastSmoothing = s.smoothing
      }

      const t = player.currentTime()
      const center = Math.round(t * sampleRate)
      const raw = analyzer.analyze(mono, sampleRate, center, s.n)
      const terms: readonly Term[] = s.smoothing ? tracker.apply(raw) : raw

      const start = center - s.size / 2
      for (let i = 0; i < s.size; i++) {
        const idx = start + i
        frame.real[i] = idx >= 0 && idx < mono.length ? mono[idx] : 0
      }
      synthesize(terms, sampleRate, center, start, frame.approx)

      const wave = waveRef.el.current?.getContext('2d')
      if (wave) drawWaveform(wave, frame.real, frame.approx, theme)
      const spec = specRef.el.current?.getContext('2d')
      if (spec) drawSpectrum(spec, analyzer.spectrum, sampleRate, terms, s.notes, theme)

      // Epicycles run on their own slowed clock, looping over the window span.
      const span = s.size / sampleRate
      tau += dt * s.timeScale
      if (tau >= span / 2) tau -= span
      trace.push(chainValue(terms, tau))
      const epi = epiRef.el.current?.getContext('2d')
      if (epi) drawEpicycles(epi, terms, tau, trace, theme)

      if (now - lastText >= TEXT_INTERVAL_MS) {
        lastText = now
        setLatex(termsToLatex(terms, { notes: s.notes }))
        const ref = rms(frame.real)
        if (ref < 1e-5) setRmsText('— (silence)')
        else {
          const rel = rmsError(frame.real, frame.approx) / ref
          setRmsText(`${(rel * 100).toFixed(1)}% · ${(20 * Math.log10(Math.max(rel, 1e-6))).toFixed(1)} dB`)
        }
        setTime(player.position())
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audio, player, waveRef, specRef, epiRef])

  const buildResynth = useCallback(() => {
    if (!audio) return
    const job = ++resynthJob.current
    const s = settingsRef.current
    const key = resynthKey(s)
    const out = new Float32Array(audio.mono.length)
    const gen = resynthesizeTrack(audio.mono, audio.sampleRate, s.size, s.n, out)
    setResynth({ status: 'building', progress: 0 })
    const step = () => {
      if (job !== resynthJob.current) return
      const until = performance.now() + 12
      let r = gen.next()
      while (!r.done && performance.now() < until) r = gen.next()
      if (!r.done) {
        setResynth({ status: 'building', progress: r.value })
        setTimeout(step, 0)
        return
      }
      const buf = player.ctx.createBuffer(1, out.length, audio.sampleRate)
      buf.copyToChannel(out, 0)
      player.setAlternate(buf)
      player.setAB('math')
      setResynth({ status: 'ready', key })
    }
    setTimeout(step, 0)
  }, [audio, player])

  const frameMs = audio ? ((settings.size / audio.sampleRate) * 1000).toFixed(1) : '—'

  return (
    <div className={`app ${audio ? 'loaded' : 'empty'}`}>
      <header className="topbar">
        <h1>
          Audio <span className="arrow">→</span> Math
        </h1>
        {audio && <span className="filename" title={audio.name}>{audio.name}</span>}
        <div className="spacer" />
        {audio && <DropZone onFile={onFile} compact busy={loading} />}
      </header>

      {error && <div className="error" role="alert">{error}</div>}

      {!audio ? (
        <main className="landing">
          <DropZone onFile={onFile} compact={false} busy={loading} />
        </main>
      ) : (
        <main className="stage">
          <FormulaPanel
            latex={latex}
            frameLabel={`t₀ = ${time.toFixed(3)} s · window ${settings.size} samples (${frameMs} ms) · top ${settings.n} peaks`}
          />
          <WaveformPanel canvasRef={waveRef.attach} error={rmsText} />
          <div className="lower">
            <SpectrumPanel canvasRef={specRef.attach} />
            <EpicyclesPanel
              canvasRef={epiRef.attach}
              timeScale={settings.timeScale}
              onTimeScale={(timeScale) => patchSettings({ timeScale })}
            />
          </div>
        </main>
      )}

      {audio && (
        <footer className="dock">
          <Transport
            playing={playing}
            time={time}
            duration={player.duration}
            disabled={!audio}
            onToggle={() => player.toggle()}
            onSeek={(t) => {
              player.seek(t)
              setTime(t)
            }}
          />
          <div className="dock-row">
            <Controls settings={settings} sampleRate={audio.sampleRate} onChange={patchSettings} />
            <HearMath
              state={resynth}
              currentKey={resynthKey(settings)}
              ab={ab}
              disabled={!audio}
              onBuild={buildResynth}
              onAB={(w) => player.setAB(w)}
            />
          </div>
        </footer>
      )}
    </div>
  )
}
