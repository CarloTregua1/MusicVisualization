import { describe, expect, it } from 'vitest'
import { RIPPLE_SPEED, detectStomp, handRaise, rippleHeight, wallPull } from '../src/render/interaction'

describe('stomp ripples', () => {
  it('travel outward from the crater', () => {
    const r = { strength: 1, side: 0 }
    // At age a the bump is centred on radius 1 + speed·a.
    for (const age of [0.2, 0.5, 0.8]) {
      const front = 1 + RIPPLE_SPEED * age
      expect(rippleHeight(front, 0, [{ ...r, age }])).toBeGreaterThan(rippleHeight(front + 1, 0, [{ ...r, age }]))
      expect(rippleHeight(front, 0, [{ ...r, age }])).toBeGreaterThan(rippleHeight(Math.max(1, front - 1), 0, [{ ...r, age }]))
    }
  })

  it('are stronger on the stomping side and fade with age', () => {
    const left = { age: 0.3, strength: 1, side: -1 }
    const front = 1 + RIPPLE_SPEED * 0.3
    expect(rippleHeight(front, Math.PI, [left])).toBeGreaterThan(rippleHeight(front, 0, [left]) * 2)
    const late = { ...left, age: 1.2 }
    expect(rippleHeight(1 + RIPPLE_SPEED * 1.2, Math.PI, [late])).toBeLessThan(rippleHeight(front, Math.PI, [left]))
  })
})

describe('hand walls', () => {
  it('rise on the raised hand side, behind the crater', () => {
    const behindLeft = 0.72 * Math.PI
    const behindRight = 0.28 * Math.PI
    expect(wallPull(behindLeft, 1, 0)).toBeCloseTo(1, 5)
    expect(wallPull(behindRight, 1, 0)).toBeLessThan(0.1)
    expect(wallPull(-Math.PI / 2, 1, 1)).toBeLessThan(0.01) // nothing in front of the crater
    expect(wallPull(behindLeft, 0, 0)).toBe(0)
  })
})

describe('dancer gestures', () => {
  it('detects a stomp only when a foot lands fast', () => {
    expect(detectStomp(0.05, 0.01, -1.2)).toBeGreaterThan(0.3)
    expect(detectStomp(0.05, 0.01, -0.2)).toBe(0) // gentle step
    expect(detectStomp(0.01, 0.005, -1.2)).toBe(0) // already on the ground
    expect(detectStomp(0.05, 0.04, -1.2)).toBe(0) // still in the air
  })

  it('measures how far a hand is raised above the head', () => {
    expect(handRaise(0.9, 0.9)).toBe(0)
    expect(handRaise(1.05, 0.9)).toBeCloseTo(1, 5)
    expect(handRaise(0.5, 0.9)).toBe(0)
  })
})
