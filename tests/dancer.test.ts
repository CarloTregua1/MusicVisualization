import { describe, expect, it } from 'vitest'
import { BEATS_PER_LOOP, DANCE_CLIPS, DANCE_JOINTS, SAMPLES_PER_BEAT } from '../src/render/danceClips'
import { Dancer, DANCE_CLIP_ENERGY, DANCE_CLIP_NAMES, MAX_POINT_SPEED, type DancerInput, type Skeleton } from '../src/render/dancer'
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

  describe('phase 2: phrasing and reactions', () => {
    const base = (index: number, phase: number, extra: Partial<DancerInput> = {}): DancerInput => ({
      beat: { index, phase, period: 0.5 },
      level: 0.7,
      onset: 0,
      bass: 0.5,
      treble: 0.5,
      brightness: 0.5,
      ...extra,
    })
    const run = (d: Dancer, from: number, beats: number, extra: (f: number) => Partial<DancerInput> = () => ({})) => {
      for (let f = 0; f < beats * 30; f++) {
        const x = from + f / 30
        d.update(1 / 60, base(Math.floor(x), x - Math.floor(x), extra(f)), { energy: 1 })
      }
    }

    it('on a drop: switches clip at once, to one of the most energetic, and jumps', () => {
      const d = new Dancer()
      d.random = () => 0.5
      run(d, 0, 3)
      const before = d.move
      const feet = () => Math.min(d.skeleton().footL.y, d.skeleton().footR.y)
      const ground = feet()
      d.update(1 / 60, base(3, 0.05, { drop: true }), { energy: 1 })
      expect(d.move).not.toBe(before)
      const top3 = Object.entries(DANCE_CLIP_ENERGY).filter(([n]) => n !== before).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n]) => n)
      expect(top3).toContain(d.move)
      // Feet leave the ground during the jump.
      let peak = -Infinity
      const d2 = new Dancer()
      run(d2, 0, 3)
      d2.update(1 / 60, base(3, 0.05, { drop: true }), { energy: 1 })
      for (let f = 0; f < 20; f++) {
        d2.update(1 / 60, base(3, 0.05 + f / 30), { energy: 1 })
        peak = Math.max(peak, Math.min(d2.skeleton().footL.y, d2.skeleton().footR.y))
      }
      expect(peak).toBeGreaterThan(ground + 0.03)
    })

    it('freezes mid-pose in the dark and jumps back in when the light returns', () => {
      const d = new Dancer()
      run(d, 0, 2)
      const pose = d.skeleton()
      run(d, 2, 2, () => ({ light: 0 }))
      expect(d.frozen).toBe(true)
      expect(d.skeleton()).toEqual(pose)
      run(d, 4, 0.2, () => ({ light: 1 }))
      expect(d.frozen).toBe(false)
    })

    it('throws a hit accent on strong onsets: hands go up', () => {
      // Same clip choices for both, so the only difference is the hit.
      const a = new Dancer()
      const b = new Dancer()
      a.random = () => 0.3
      b.random = () => 0.3
      run(a, 0, 2)
      run(b, 0, 2)
      for (let f = 0; f < 6; f++) {
        a.update(1 / 60, base(2, f / 60), { energy: 1 })
        b.update(1 / 60, base(2, f / 60, { onset: f === 0 ? 1 : 0 }), { energy: 1 })
      }
      const hands = (d: Dancer) => d.skeleton().handL.y + d.skeleton().handR.y
      expect(hands(b)).toBeGreaterThan(hands(a) + 0.02)
    })
  })

  describe('phase 3: history for trails and echoes', () => {
    it('remembers recent poses: trails run newest first within the time window', () => {
      const { d } = dance(4, 0.8)
      const tr = d.jointTrail('handL', 0.4)
      expect(tr.length / 3).toBeGreaterThan(15)
      for (let n = 5; n < tr.length; n += 3) expect(tr[n]).toBeGreaterThanOrEqual(tr[n - 3])
      expect(tr[tr.length - 1]).toBeLessThanOrEqual(0.4)
      // The newest trail point is where the hand is now.
      expect(tr[0]).toBeCloseTo(d.skeleton().handL.x, 6)
      expect(tr[1]).toBeCloseTo(d.skeleton().handL.y, 6)
    })

    it('gives the pose from a moment ago for echoes, and nothing beyond the history', () => {
      const { d } = dance(4, 0.8)
      const now = d.skeleton()
      const past = d.pastSkeleton(0.25)!
      expect(past).not.toBeNull()
      expect(Math.hypot(past.handL.x - now.handL.x, past.handL.y - now.handL.y)).toBeGreaterThan(0.001)
      expect(d.pastSkeleton(5)).toBeNull()
    })
  })
})
