import { describe, expect, it } from 'vitest'
import { RollCamera } from '../src/render/camera'

const DT = 1 / 60
const DEG = 180 / Math.PI

/** Deterministic pseudo-random sequence so runs are reproducible. */
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
}

/** Samples a long run and splits it into phases at each direction reversal. */
function run(seconds: number, seed = 42) {
  const cam = new RollCamera({}, seeded(seed))
  const angles: number[] = []
  for (let i = 0; i < seconds / DT; i++) angles.push(cam.update(DT) * DEG)
  const reversals: number[] = []
  for (let i = 2; i < angles.length; i++) {
    const v0 = angles[i - 1] - angles[i - 2]
    const v1 = angles[i] - angles[i - 1]
    if (v0 !== 0 && Math.sign(v1) !== Math.sign(v0)) reversals.push(i - 1)
  }
  return { angles, reversals }
}

describe('RollCamera', () => {
  it('never tilts more than 10 degrees either way', () => {
    for (const seed of [1, 7, 42, 99]) {
      const { angles } = run(300, seed)
      expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(10 + 1e-9)
    }
  })

  it('alternates left and right, each phase lasting at least 5 seconds', () => {
    const { angles, reversals } = run(300)
    expect(reversals.length).toBeGreaterThan(30)
    for (let k = 1; k < reversals.length; k++) {
      expect((reversals[k] - reversals[k - 1]) * DT).toBeGreaterThanOrEqual(5)
      // Consecutive turning points lie on opposite sides.
      expect(Math.sign(angles[reversals[k]])).toBe(-Math.sign(angles[reversals[k - 1]]))
    }
  })

  it('slows almost to a stop at each reversal and is fastest mid-swing', () => {
    const { angles, reversals } = run(120)
    for (let k = 1; k < reversals.length; k++) {
      const a = reversals[k - 1]
      const b = reversals[k]
      const speed = (i: number) => Math.abs(angles[i + 1] - angles[i]) / DT // deg/s
      const peak = Math.max(...angles.slice(a, b).map((_, j) => speed(a + j)))
      expect(speed(a)).toBeLessThan(peak * 0.05)
      expect(speed(b - 1)).toBeLessThan(peak * 0.05)
      expect(speed(Math.round((a + b) / 2))).toBeGreaterThan(peak * 0.9)
    }
  })
})
