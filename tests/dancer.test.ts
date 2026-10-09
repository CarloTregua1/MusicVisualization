import { describe, expect, it } from 'vitest'
import { BEATS_PER_MOVE, Dancer, MAX_JOINT_SPEED, movePose, solveSkeleton, type DancerInput, type MoveName } from '../src/render/dancer'
import { MAX_COLOUR_LIGHTNESS } from '../src/render/tubeColor'

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
const MOVES: MoveName[] = ['idle', 'bounce', 'pump', 'sidestep', 'wave', 'jump']

/** Runs a dancer through `beats` beats at 120 BPM, 60 fps, returning it and its move at every frame. */
function dance(beats: number, level: number, seed = 5, bpm = 120, onFrame?: (d: Dancer) => void) {
  const d = new Dancer()
  d.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const frames: { index: number; move: MoveName }[] = []
  const dt = 1 / 60
  const perBeat = Math.round((60 / bpm) * 60)
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
    d.update(dt, input, { energy: 1 })
    onFrame?.(d)
    frames.push({ index: input.beat.index, move: d.move })
  }
  return { d, frames }
}

describe('dancer', () => {
  it('keeps every bone the same length in every pose', () => {
    const ref = solveSkeleton(movePose('idle', 0, 0, 0))
    const bones: [keyof typeof ref, keyof typeof ref][] = [
      ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR'],
      ['shoulderL', 'elbowL'], ['elbowL', 'handL'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'], ['pelvis', 'neck'],
    ]
    for (const move of MOVES)
      for (const p of [0, 0.13, 0.5, 0.87])
        for (const i of [0, 1])
          for (const e of [0, 0.5, 1]) {
            const sk = solveSkeleton(movePose(move, p, i, e))
            for (const [a, b] of bones) expect(dist(sk[a], sk[b])).toBeCloseTo(dist(ref[a], ref[b]), 6)
            // Feet stay below the hips, and one foot is on (or above) the ground.
            expect(sk.footL.y).toBeLessThan(sk.hipL.y)
            expect(sk.footR.y).toBeLessThan(sk.hipR.y)
            expect(Math.min(sk.footL.y, sk.footR.y)).toBeGreaterThanOrEqual(-1e-9)
          }
  })

  it('barely moves when there is no energy', () => {
    const { d } = dance(16, 0)
    const idle = solveSkeleton(movePose('idle', 0, 0, 0))
    const now = solveSkeleton(d.currentPose)
    for (const k of Object.keys(idle) as (keyof typeof idle)[]) expect(dist(idle[k], now[k])).toBeLessThan(0.03)
  })

  it('changes move only on 8-beat boundaries', () => {
    const { frames } = dance(64, 0.8)
    const changes = frames.filter((f, i) => i > 0 && f.move !== frames[i - 1].move)
    expect(changes.length).toBeGreaterThan(2)
    for (const c of changes) expect(c.index % BEATS_PER_MOVE).toBe(0)
  })

  it('is never white, however bright the light', () => {
    const d = new Dancer()
    for (const light of [0.5, 1, 2, 5]) {
      const l = Number(/(\d+)%\)$/.exec(d.colour(0.5, light, 0.6))![1])
      expect(l).toBeLessThanOrEqual(MAX_COLOUR_LIGHTNESS)
    }
  })

  it('moves at human speed: no joint turns faster than the limit', () => {
    let prev: Record<string, number> | null = null
    let fastest = 0
    dance(48, 1, 9, 120, (d) => {
      const p = d.currentPose as unknown as Record<string, number>
      if (prev) for (const k of ['armL', 'armR', 'elbowL', 'elbowR', 'legL', 'legR', 'kneeL', 'kneeR', 'lean', 'nod'])
        fastest = Math.max(fastest, Math.abs(p[k] - prev[k]) * 60)
      prev = { ...p }
    })
    expect(fastest).toBeLessThanOrEqual(MAX_JOINT_SPEED + 1e-6)
    expect(fastest).toBeGreaterThan(2) // still clearly dancing
  })

  it('dances in half time when the music is fast', () => {
    // At 160 BPM, moves change only every 16 musical beats (8 dance beats).
    const { frames } = dance(96, 0.8, 5, 160)
    const changes = frames.filter((f, i) => i > 0 && f.move !== frames[i - 1].move)
    expect(changes.length).toBeGreaterThan(1)
    for (const c of changes) expect(c.index % (2 * BEATS_PER_MOVE)).toBe(0)
  })
})
