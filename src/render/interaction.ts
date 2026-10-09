/** How the dancer and the tubes affect each other: pure maths, used by the tunnel and the dancer. */

/** A stomp ripple: born at the crater when a foot lands, travelling outward through the rings. */
export interface Ripple {
  /** Seconds since the stomp. */
  age: number
  /** 0..1. */
  strength: number
  /** Which side stomped: −1 screen-left, +1 screen-right. */
  side: number
}

/** Ripple fronts travel outward at this many crater radii per second… */
export const RIPPLE_SPEED = 3.2
/** …are this wide (crater radii)… */
const RIPPLE_WIDTH = 0.45
/** …and fade over this long (s). */
export const RIPPLE_LIFE = 1.6

/**
 * Extra height (in height units) a ring of radius R gets at angle θ from the
 * ripples passing through it: a bump at each front, stronger on the stomping
 * side, fading with age.
 */
export function rippleHeight(R: number, theta: number, ripples: readonly Ripple[]): number {
  let h = 0
  for (const r of ripples) {
    const front = 1 + RIPPLE_SPEED * r.age
    const d = (R - front) / RIPPLE_WIDTH
    if (d < -3 || d > 3) continue
    // World +x is screen-right; θ = 0 points along +x.
    const sideWeight = 0.55 + 0.45 * r.side * Math.cos(theta)
    h += r.strength * Math.exp(-d * d) * Math.exp(-r.age * (2 / RIPPLE_LIFE)) * sideWeight
  }
  return h
}

/** Angles (radians) of the walls a raised hand pulls up: behind the crater, on the hand's side. */
const PULL_LEFT = 0.72 * Math.PI
const PULL_RIGHT = 0.28 * Math.PI
const PULL_WIDTH = 0.42

/** Extra height (height units) at angle θ of a ring formed while the hands were raised by pullL / pullR (0..1). */
export function wallPull(theta: number, pullL: number, pullR: number): number {
  const bump = (centre: number) => {
    let d = theta - centre
    d = Math.atan2(Math.sin(d), Math.cos(d))
    return Math.exp(-((d / PULL_WIDTH) ** 2))
  }
  return pullL * bump(PULL_LEFT) + pullR * bump(PULL_RIGHT)
}

/** A foot counts as stomping when it reaches the ground moving down at least this fast (figure heights/s). */
const STOMP_SPEED = 0.28
/** Height (figure heights) below which a foot is on the ground. */
const GROUND = 0.03

/** Stomp strength 0..1 when a foot lands this frame (was above the ground, now on it, moving down fast), else 0. */
export function detectStomp(prevY: number, y: number, vy: number): number {
  if (prevY > GROUND && y <= GROUND && vy < -STOMP_SPEED) return Math.min(1, (-vy - STOMP_SPEED) / 1.2 + 0.35)
  return 0
}

/** How far a hand is raised above the head, 0..1 (figure heights: 0 at head height, 1 at 0.15 above). */
export function handRaise(handY: number, headY: number): number {
  return Math.min(1, Math.max(0, (handY - headY) / 0.15))
}
