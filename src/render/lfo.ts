import { PARAM_SPECS, type NumericParam, type ParamSpec, type TunnelParams } from './tunnelParams'

export type LfoShape = 'sine' | 'triangle' | 'sawUp' | 'sawDown' | 'square'

export const LFO_SHAPES: { shape: LfoShape; symbol: string; label: string }[] = [
  { shape: 'sine', symbol: '∿', label: 'Sine' },
  { shape: 'triangle', symbol: '△', label: 'Triangle' },
  { shape: 'sawUp', symbol: '⟋', label: 'Saw up' },
  { shape: 'sawDown', symbol: '⟍', label: 'Saw down' },
  { shape: 'square', symbol: '⊓', label: 'Square' },
]

/** On/off settings an LFO can switch, besides the sliders. */
export type ToggleParam = 'dancerOn'

export const TOGGLE_TARGETS: { key: ToggleParam; label: string; group: string }[] = [
  { key: 'dancerOn', label: 'Dancer on/off', group: 'Dancer' },
]

export type LfoTarget = NumericParam | ToggleParam

export const isToggle = (target: LfoTarget): target is ToggleParam => TOGGLE_TARGETS.some((t) => t.key === target)

/**
 * A low-frequency oscillator that sweeps one slider around its set value, or
 * switches an on/off setting for part of each cycle.
 */
export interface Lfo {
  on: boolean
  /** The slider it moves, or the setting it switches. */
  target: LfoTarget
  shape: LfoShape
  /** true: the cycle is `beats` long on the song's beat grid; false: `hz` cycles per second. */
  sync: boolean
  /** Cycle length in beats when synced (4 beats = 1 bar). */
  beats: number
  /** Cycles per second when free. */
  hz: number
  /**
   * Sliders: how far it swings, as a fraction of the slider's half-range.
   * Toggles: the share of each cycle the setting is flipped. 0..1.
   */
  depth: number
}

/** Cycle lengths offered when synced. */
export const LFO_LENGTHS: { beats: number; label: string }[] = [
  { beats: 0.25, label: '1/4 beat' },
  { beats: 0.5, label: '1/2 beat' },
  { beats: 1, label: '1 beat' },
  { beats: 2, label: '2 beats' },
  { beats: 4, label: '1 bar' },
  { beats: 8, label: '2 bars' },
  { beats: 16, label: '4 bars' },
  { beats: 32, label: '8 bars' },
  { beats: 64, label: '16 bars' },
]

export const LFO_HZ_MIN = 0.02
export const LFO_HZ_MAX = 4

/** The wave at a phase (0..1), from −1 to 1. Every shape starts its cycle on a downbeat. */
export function wave(shape: LfoShape, phase: number): number {
  const p = phase - Math.floor(phase)
  switch (shape) {
    case 'sine':
      return Math.sin(p * Math.PI * 2)
    case 'triangle':
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4
    case 'sawUp':
      return 2 * p - 1
    case 'sawDown':
      return 1 - 2 * p
    case 'square':
      return p < 0.5 ? 1 : -1
  }
}

const SPECS = new Map<NumericParam, ParamSpec>(PARAM_SPECS.map((s) => [s.key, s]))

/** Where the song is, for the LFOs: beats on the bar grid (synced) and seconds (free). */
export interface LfoClock {
  beats: number
  seconds: number
}

/**
 * The parameters with every active LFO applied: each swings its slider by
 * depth × half the slider's range around the set value (LFOs on the same
 * slider add up), clamped to the slider's range and rounded on whole-number
 * sliders. A toggle is flipped from its set state while the wave is below
 * 2·depth − 1, which for saws and triangles is exactly `depth` of each cycle
 * (square: the second half). Returns `base` itself when no LFO is on.
 */
export function applyLfos(base: TunnelParams, clock: LfoClock): TunnelParams {
  let out: TunnelParams | null = null
  const flipped = new Set<ToggleParam>()
  for (const lfo of base.lfos) {
    if (!lfo.on || lfo.depth <= 0) continue
    const phase = lfo.sync ? clock.beats / lfo.beats : clock.seconds * lfo.hz
    const w = wave(lfo.shape, phase)
    out ??= { ...base }
    if (isToggle(lfo.target)) {
      if (w < 2 * lfo.depth - 1 && !flipped.has(lfo.target)) {
        flipped.add(lfo.target)
        out[lfo.target] = !base[lfo.target]
      }
      continue
    }
    const spec = SPECS.get(lfo.target)
    if (spec) out[lfo.target] += (lfo.depth * (spec.max - spec.min)) / 2 * w
  }
  if (!out) return base
  for (const lfo of base.lfos) {
    if (isToggle(lfo.target)) continue
    const spec = SPECS.get(lfo.target)
    if (!lfo.on || !spec) continue
    const v = Math.min(spec.max, Math.max(spec.min, out[lfo.target]))
    out[lfo.target] = spec.step >= 1 ? Math.round(v) : v
  }
  return out
}
