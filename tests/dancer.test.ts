import { describe, expect, it } from 'vitest'
import { BEATS_PER_LOOP, DANCE_CLIPS, DANCE_JOINTS, SAMPLES_PER_BEAT } from '../src/render/danceClips'
import { Dancer, DANCE_CLIP_NAMES, MAX_POINT_SPEED, type DancerInput, type Skeleton } from '../src/render/dancer'
import { MAX_COLOUR_LIGHTNESS } from '../src/render/tubeColor'

const J = DANCE_JOINTS.length
const FRAMES = BEATS_PER_LOOP * SAMPLES_PER_BEAT

/** Runs a dancer for `beats` beats at `bpm`, 60 fps, calling onFrame after each update. */
function dance(beats: number, level: number, seed = 5, bpm = 120, onFrame?: (d: Dancer, index: number) => void) {
  const d = new Dancer()
  d.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const perBeat = Math.round((60 / bpm) * 60)
  const frames: { index: number; move: string }[] = []
  for (let f = 0; f < beats * perBeat; f++) {
    const x = f / perBeat
    const input: DancerInput = {
      beat: { index: Math.floor(x), phase: x - Math.floor(x), period: 60 / bpm },
      level,
      onset: f % perBeat === 0 ? 0.8 : 0,
      bass: 0.6,
      treble: 0.4,
      brightness: 0.4,
    }
    d.update(1 / 60, input, { energy: 1 })
    onFrame?.(d, input.beat.index)
    frames.push({ index: input.beat.index, move: d.move })
  }
  return { d, frames }
}

const maxStep = (a: Skeleton, b: Skeleton) =>
  Math.max(...(Object.keys(a) as (keyof Skeleton)[]).map((k) => Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)))

describe('dance clips (motion capture)', () => {
  it('are well-formed, human-sized, standing on the ground, and loop seamlessly', () => {
    expect(DANCE_CLIPS.length).toBeGreaterThanOrEqual(5)
    for (const c of DANCE_CLIPS) {
      expect(c.frames.length).toBe(FRAMES * J * 2)
      const at = (f: number, joint: string, axis: 0 | 1) => c.frames[f * J * 2 + DANCE_JOINTS.indexOf(joint as never) * 2 + axis]
      for (let f = 0; f < FRAMES; f++) {
        // Head above pelvis above the lower foot; everything within a sane box.
        expect(at(f, 'head', 1)).toBeGreaterThan(at(f, 'pelvis', 1))
        expect(at(f, 'pelvis', 1)).toBeGreaterThan(Math.min(at(f, 'footL', 1), at(f, 'footR', 1)))
        for (let k = 0; k < J * 2; k++) expect(Math.abs(c.frames[f * J * 2 + k])).toBeLessThan(1.6)
      }
      // The lowest foot stays near the ground on average.
      let low = 0
      for (let f = 0; f < FRAMES; f++) low += Math.min(at(f, 'footL', 1), at(f, 'footR', 1))
      expect(Math.abs(low / FRAMES)).toBeLessThan(0.08)
      // Seamless: the last frame flows into the first like any other step.
      let jump = 0
      let typical = 0
      for (let k = 0; k < J * 2; k++) {
        jump = Math.max(jump, Math.abs(c.frames[k] - c.frames[(FRAMES - 1) * J * 2 + k]))
        typical = Math.max(typical, Math.abs(c.frames[J * 2 + k] - c.frames[k]))
      }
      expect(jump).toBeLessThan(Math.max(0.05, typical * 3))
    }
  })
})

describe('dancer', () => {
  it('moves at human speed: no joint faster than the limit', () => {
    let prev: Skeleton | null = null
    let fastest = 0
    dance(48, 1, 9, 120, (d) => {
      const sk = d.skeleton()
      if (prev) fastest = Math.max(fastest, maxStep(prev, sk) * 60)
      prev = sk
    })
    expect(fastest).toBeLessThanOrEqual(MAX_POINT_SPEED + 1e-6)
    expect(fastest).toBeGreaterThan(0.5) // clearly dancing
  })

  it('relaxes when the music is quiet', () => {
    let quiet = 0
    let loud = 0
    for (const [level, set] of [[0, (v: number) => (quiet = v)], [1, (v: number) => (loud = v)]] as const) {
      let prev: Skeleton | null = null
      let total = 0
      dance(32, level, 4, 120, (d) => {
        const sk = d.skeleton()
        if (prev) total += maxStep(prev, sk)
        prev = sk
      })
      set(total)
    }
    expect(quiet).toBeLessThan(loud * 0.35)
  })

  it('changes clip only on 8-beat boundaries, and uses several clips', () => {
    const { frames } = dance(80, 0.8)
    const changes = frames.filter((f, i) => i > 0 && f.move !== frames[i - 1].move)
    expect(changes.length).toBeGreaterThan(3)
    for (const c of changes) expect(c.index % BEATS_PER_LOOP).toBe(0)
    expect(new Set(frames.map((f) => f.move)).size).toBeGreaterThanOrEqual(3)
    for (const f of frames) expect(DANCE_CLIP_NAMES).toContain(f.move)
  })

  it('dances in half time when the music is fast', () => {
    const { frames } = dance(96, 0.8, 5, 160)
    const changes = frames.filter((f, i) => i > 0 && f.move !== frames[i - 1].move)
    expect(changes.length).toBeGreaterThan(1)
    for (const c of changes) expect(c.index % (2 * BEATS_PER_LOOP)).toBe(0)
  })

  it('is never white, however bright the light', () => {
    const d = new Dancer()
    for (const light of [0.5, 1, 2, 5]) {
      const l = Number(/(\d+)%\)$/.exec(d.colour(0.5, light, 0.6))![1])
      expect(l).toBeLessThanOrEqual(MAX_COLOUR_LIGHTNESS)
    }
  })
})
