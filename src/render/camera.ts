const DEG = Math.PI / 180

export interface RollOptions {
  /** Largest tilt either way, degrees. */
  maxDeg: number
  /** Smallest tilt a phase swings to, degrees (each phase picks in [minDeg, maxDeg]). */
  minDeg: number
  /** Phase duration range, seconds. */
  minPhase: number
  maxPhase: number
}

const DEFAULTS: RollOptions = { maxDeg: 10, minDeg: 7, minPhase: 5.5, maxPhase: 7 }

/**
 * Camera roll that alternates left and right. Each phase swings from the
 * current tilt to a new one on the other side, eased in and out (cosine),
 * so the camera slows almost to a stop at every reversal and is fastest
 * mid-swing. Phase lengths and swing sizes vary a little each time.
 */
export class RollCamera {
  private readonly opts: RollOptions
  private readonly random: () => number
  private from = 0
  private to: number
  private elapsed = 0
  private duration: number

  constructor(opts: Partial<RollOptions> = {}, random: () => number = Math.random) {
    this.opts = { ...DEFAULTS, ...opts }
    this.random = random
    this.to = (this.random() < 0.5 ? -1 : 1) * this.pickAngle()
    this.duration = this.pickDuration()
  }

  private pickAngle(): number {
    const { minDeg, maxDeg } = this.opts
    return (minDeg + (maxDeg - minDeg) * this.random()) * DEG
  }

  private pickDuration(): number {
    const { minPhase, maxPhase } = this.opts
    return minPhase + (maxPhase - minPhase) * this.random()
  }

  /** Advances by dt seconds and returns the roll angle in radians. */
  update(dt: number): number {
    this.elapsed += dt
    while (this.elapsed >= this.duration) {
      this.elapsed -= this.duration
      this.from = this.to
      this.to = -Math.sign(this.from) * this.pickAngle()
      this.duration = this.pickDuration()
    }
    return this.angle
  }

  /** Current roll angle in radians. */
  get angle(): number {
    const u = this.elapsed / this.duration
    return this.from + (this.to - this.from) * (0.5 - 0.5 * Math.cos(Math.PI * u))
  }
}
