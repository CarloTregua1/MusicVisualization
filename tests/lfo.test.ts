import { describe, expect, it } from 'vitest'
import { applyLfos, wave, type Lfo } from '../src/render/lfo'
import { MEASURED_PARAMS, type TunnelParams } from '../src/render/tunnelParams'

const lfo = (over: Partial<Lfo>): Lfo => ({ on: true, target: 'wallHeight', shape: 'sine', sync: true, beats: 4, hz: 1, depth: 1, ...over })
const withLfos = (lfos: Lfo[], over: Partial<TunnelParams> = {}): TunnelParams => ({ ...MEASURED_PARAMS, ...over, lfos })

describe('wave', () => {
  it('sine starts at 0 and peaks a quarter of the way in', () => {
    expect(wave('sine', 0)).toBeCloseTo(0)
    expect(wave('sine', 0.25)).toBeCloseTo(1)
    expect(wave('sine', 0.75)).toBeCloseTo(-1)
  })
  it('triangle peaks at 1/4 and dips at 3/4', () => {
    expect(wave('triangle', 0)).toBeCloseTo(0)
    expect(wave('triangle', 0.25)).toBeCloseTo(1)
    expect(wave('triangle', 0.5)).toBeCloseTo(0)
    expect(wave('triangle', 0.75)).toBeCloseTo(-1)
  })
  it('saws ramp across the cycle', () => {
    expect(wave('sawUp', 0)).toBeCloseTo(-1)
    expect(wave('sawUp', 0.5)).toBeCloseTo(0)
    expect(wave('sawDown', 0)).toBeCloseTo(1)
    expect(wave('sawDown', 0.75)).toBeCloseTo(-0.5)
  })
  it('square is high then low, and phases wrap', () => {
    expect(wave('square', 0.1)).toBe(1)
    expect(wave('square', 0.6)).toBe(-1)
    expect(wave('square', 1.1)).toBe(1)
    expect(wave('square', -0.4)).toBe(-1)
  })
})

describe('applyLfos', () => {
  const clock = { beats: 1, seconds: 0 }

  it('returns the same object when no LFO is on', () => {
    const base = withLfos([lfo({ on: false })])
    expect(applyLfos(base, clock)).toBe(base)
  })

  it('swings by depth × half the slider range at the peak', () => {
    // Walls: range 0..5, set to 2; a 4-beat sine peaks on beat 1.
    const out = applyLfos(withLfos([lfo({ depth: 0.4 })], { wallHeight: 2 }), clock)
    expect(out.wallHeight).toBeCloseTo(2 + 0.4 * 2.5)
  })

  it('clamps to the slider range', () => {
    const out = applyLfos(withLfos([lfo({ depth: 1 })], { wallHeight: 4.5 }), clock)
    expect(out.wallHeight).toBe(5)
  })

  it('rounds whole-number sliders', () => {
    // Crowd: 0..6 step 1; 0.3 × 3 = 0.9 added to 2 → 3.
    const out = applyLfos(withLfos([lfo({ target: 'crowdSize', depth: 0.3 })], { crowdSize: 2 }), clock)
    expect(out.crowdSize).toBe(3)
  })

  it('adds LFOs on the same slider', () => {
    const out = applyLfos(withLfos([lfo({ depth: 0.2 }), lfo({ depth: 0.2 })], { wallHeight: 1 }), clock)
    expect(out.wallHeight).toBeCloseTo(1 + 2 * 0.2 * 2.5)
  })

  it('a synced one-bar LFO repeats every 4 beats; a free one follows seconds', () => {
    const base = withLfos([lfo({ shape: 'sawUp', depth: 0.5 })], { wallHeight: 2.5 })
    expect(applyLfos(base, { beats: 1, seconds: 0 }).wallHeight).toBeCloseTo(applyLfos(base, { beats: 5, seconds: 9 }).wallHeight)
    const free = withLfos([lfo({ sync: false, hz: 0.5 })], { wallHeight: 2.5 })
    expect(applyLfos(free, { beats: 0, seconds: 0.5 }).wallHeight).toBeCloseTo(2.5 + 2.5)
  })

  it('switches the dancer off for depth of each cycle', () => {
    // Saw up over one bar: below 2·0.25 − 1 = −0.5 for the first quarter of the bar.
    const base = withLfos([lfo({ target: 'dancerOn', shape: 'sawUp', depth: 0.25 })], { dancerOn: true })
    expect(applyLfos(base, { beats: 0.5, seconds: 0 }).dancerOn).toBe(false)
    expect(applyLfos(base, { beats: 1.5, seconds: 0 }).dancerOn).toBe(true)
    expect(applyLfos(base, { beats: 4.5, seconds: 0 }).dancerOn).toBe(false)
  })

  it('switches a dancer that is off on instead', () => {
    const base = withLfos([lfo({ target: 'dancerOn', shape: 'square', depth: 0.5 })], { dancerOn: false })
    expect(applyLfos(base, { beats: 1, seconds: 0 }).dancerOn).toBe(false)
    expect(applyLfos(base, { beats: 3, seconds: 0 }).dancerOn).toBe(true)
  })
})
