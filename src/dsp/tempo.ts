import { RealFFT } from './fft'
import { hann } from './window'

const FFT_SIZE = 1024
const HOP = 512
const MIN_BPM = 70
const MAX_BPM = 180
/** Tempo prior: log-normal around 120 BPM, to settle octave ambiguities. */
const PRIOR_BPM = 120
const PRIOR_OCTAVES = 0.9

export interface TempoTrack {
  /** Seconds between tempo estimates. */
  step: number
  /** BPM per step (NaN where the track is too quiet to tell). */
  bpm: Float32Array
  /** The onset envelope it was computed from (reused by the beat tracker). */
  envelope: Float32Array
  /** Seconds between envelope frames. */
  hopSec: number
  /** Time (s) of envelope frame 0: frames are centred on their FFT window. */
  envelopeStart: number
}

/**
 * Onset strength per hop: spectral flux of log-compressed magnitudes, minus
 * its local mean and half-wave rectified, so only sudden energy rises remain.
 */
export function* onsetEnvelope(mono: Float32Array, sampleRate: number): Generator<number, Float32Array> {
  const fft = new RealFFT(FFT_SIZE)
  const w = hann(FFT_SIZE).coeffs
  const frame = new Float64Array(FFT_SIZE)
  const bins = FFT_SIZE / 2
  // Ignore content above ~11 kHz: it is mostly hiss as far as rhythm goes.
  const maxBin = Math.min(bins, Math.round((11000 / sampleRate) * FFT_SIZE))
  const prev = new Float64Array(maxBin)
  const frames = Math.max(0, Math.floor((mono.length - FFT_SIZE) / HOP) + 1)
  const flux = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    const start = f * HOP
    for (let n = 0; n < FFT_SIZE; n++) frame[n] = mono[start + n] * w[n]
    const out = fft.transform(frame)
    let sum = 0
    for (let k = 1; k < maxBin; k++) {
      const re = out[2 * k]
      const im = out[2 * k + 1]
      const l = Math.log1p(100 * Math.sqrt(re * re + im * im))
      const d = l - prev[k]
      if (d > 0) sum += d
      prev[k] = l
    }
    flux[f] = sum
    if (f % 512 === 511) yield (f / frames) * 0.6
  }
  // Subtract a ~0.4 s moving average and rectify.
  const half = Math.round((0.2 * sampleRate) / HOP)
  const env = new Float32Array(frames)
  let acc = 0
  let lo = 0
  let hi = 0
  for (let f = 0; f < frames; f++) {
    while (hi < Math.min(frames, f + half + 1)) acc += flux[hi++]
    while (lo < f - half) acc -= flux[lo++]
    env[f] = Math.max(0, flux[f] - acc / (hi - lo))
  }
  // Light [1 2 1]/4 smoothing, twice: onset peaks are 1–2 hops wide, so a
  // beat period that falls between integer lags would otherwise lose most of
  // its correlation to rounding and lose out to its double.
  for (let pass = 0; pass < 2; pass++) {
    let a = env[0]
    for (let f = 1; f < frames - 1; f++) {
      const b = env[f]
      env[f] = 0.25 * a + 0.5 * b + 0.25 * env[f + 1]
      a = b
    }
  }
  return env
}

/**
 * Local tempo every `step` seconds from autocorrelation of the onset
 * envelope over a centred window. Analysis is offline (the whole file is
 * decoded), so the window can look ahead as well as back.
 */
export function* analyzeTempo(
  mono: Float32Array,
  sampleRate: number,
  step = 0.5,
  windowSec = 8,
): Generator<number, TempoTrack> {
  const env = yield* onsetEnvelope(mono, sampleRate)
  const hopSec = HOP / sampleRate
  const minLag = Math.floor(60 / MAX_BPM / hopSec)
  const maxLag = Math.ceil(60 / MIN_BPM / hopSec)
  const halfWin = Math.round(windowSec / 2 / hopSec)
  const steps = Math.max(1, Math.ceil(mono.length / sampleRate / step))
  const raw = new Float32Array(steps)
  const score = new Float64Array(2 * maxLag + 2)

  let total = 0
  for (let i = 0; i < env.length; i++) total += env[i]
  const meanEnv = env.length ? total / env.length : 0

  for (let s = 0; s < steps; s++) {
    const c = Math.round((s * step) / hopSec)
    const a = Math.max(0, c - halfWin)
    const b = Math.min(env.length, c + halfWin)
    let energy = 0
    for (let i = a; i < b; i++) energy += env[i]
    if (b - a < maxLag * 2 || energy / (b - a) < meanEnv * 0.15 || energy === 0) {
      raw[s] = NaN
      continue
    }
    for (let lag = minLag; lag <= 2 * maxLag + 1; lag++) {
      let acc = 0
      for (let i = a; i + lag < b; i++) acc += env[i] * env[i + lag]
      score[lag] = acc / (b - a - lag)
    }
    let best = -1
    let bestScore = -Infinity
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = 60 / (lag * hopSec)
      const oct = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES
      // A true beat period also correlates at twice the lag.
      const v = (score[lag] + 0.5 * score[2 * lag]) * Math.exp(-0.5 * oct * oct)
      if (v > bestScore) {
        bestScore = v
        best = lag
      }
    }
    // Parabolic refinement of the winning lag.
    let lag = best
    if (best > minLag && best < maxLag) {
      const y0 = score[best - 1]
      const y1 = score[best]
      const y2 = score[best + 1]
      const d = y0 - 2 * y1 + y2
      if (d < 0) lag = best + (0.5 * (y0 - y2)) / d
    }
    raw[s] = 60 / (lag * hopSec)
    if (s % 16 === 15) yield 0.6 + (0.4 * s) / steps
  }

  // Median of 5 removes isolated octave slips.
  const bpm = new Float32Array(steps)
  const win: number[] = []
  for (let s = 0; s < steps; s++) {
    win.length = 0
    for (let j = s - 2; j <= s + 2; j++) if (j >= 0 && j < steps && !Number.isNaN(raw[j])) win.push(raw[j])
    win.sort((x, y) => x - y)
    bpm[s] = Number.isNaN(raw[s]) || win.length === 0 ? NaN : win[win.length >> 1]
  }
  return { step, bpm, envelope: env, hopSec, envelopeStart: FFT_SIZE / 2 / sampleRate }
}

/** Runs a generator to completion synchronously (tests, small inputs). */
export function runToEnd<T>(gen: Generator<number, T>): T {
  let r = gen.next()
  while (!r.done) r = gen.next()
  return r.value
}

/** Tempo at time t, linearly interpolated; falls back to the nearest known value. */
export function tempoAt(track: TempoTrack, t: number): number {
  const { bpm, step } = track
  const x = Math.max(0, Math.min(bpm.length - 1, t / step))
  const i = Math.floor(x)
  const j = Math.min(bpm.length - 1, i + 1)
  const a = bpm[i]
  const b = bpm[j]
  if (!Number.isNaN(a) && !Number.isNaN(b)) return a + (b - a) * (x - i)
  if (!Number.isNaN(a)) return a
  if (!Number.isNaN(b)) return b
  for (let d = 1; d < bpm.length; d++) {
    if (i - d >= 0 && !Number.isNaN(bpm[i - d])) return bpm[i - d]
    if (j + d < bpm.length && !Number.isNaN(bpm[j + d])) return bpm[j + d]
  }
  return NaN
}
