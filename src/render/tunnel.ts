import { neon } from './neon'

const MAX_RINGS = 48
const POINTS = 320
/** Kaleidoscope symmetry: the spectrum is mirrored this many times around each ring. */
const FOLDS = 6
/** Colour stops per mirrored half-segment of a ring's conic gradient. */
const STOPS_PER_HALF = 5

interface Ring {
  bands: Float32Array
  /** Depth: 0 at birth (at the hollow core), 1 when it leaves the screen. */
  u: number
  level: number
  lobes: number
  temperature: number
  beat: number
  /** Mean level of the top bands, drives the fine shimmer on the string. */
  treble: number
  /** Seconds since birth, for the string's vibration. */
  age: number
  angle: number
  gradient: CanvasGradient | null
}

/** Mirrored fold of an angle to a 0..1 spectrum position (0 = bass, 1 = treble). */
function fold(theta: number): number {
  const seg = (2 * Math.PI) / FOLDS
  const s = (((theta % seg) + seg) % seg) / seg
  return s < 0.5 ? 2 * s : 2 - 2 * s
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export interface TunnelInput {
  /** Band levels 0..1, bass first. Copied, so the caller may reuse the array. */
  bands: Float32Array
  /** Overall loudness 0..1. */
  level: number
  /** Number of lobes from the dominant pitch. */
  lobes: number
  /** 0 = cold, 1 = hot. */
  temperature: number
  /** 0..1, 1 on a fresh beat. */
  beat: number
}

/**
 * A neon tunnel of concentric spectral strings. A string is born at the
 * hollow centre every `spawnInterval` seconds; until the next one is born it
 * keeps following the live sound, then it freezes that spectrum and travels
 * outward with perspective, vibrating like a plucked string as it goes. So
 * the innermost string is always the sound playing now. A short feedback
 * pass (last frame redrawn slightly zoomed) adds faint self-similar trails.
 */
export class Tunnel {
  private readonly rings: Ring[]
  private head = 0
  private count = 0
  private spawnAcc = 0
  private angle = 0
  private time = 0
  private beatGlow = 0
  private readonly fold: Float32Array
  private readonly cos: Float32Array
  private readonly sin: Float32Array
  private readonly feedback: HTMLCanvasElement
  private feedbackCtx: CanvasRenderingContext2D | null = null

  constructor(bandCount: number) {
    this.rings = Array.from({ length: MAX_RINGS }, () => ({
      bands: new Float32Array(bandCount),
      u: 1,
      level: 0,
      lobes: 0,
      temperature: 0.5,
      beat: 0,
      treble: 0,
      age: 0,
      angle: 0,
      gradient: null,
    }))
    this.fold = new Float32Array(POINTS)
    this.cos = new Float32Array(POINTS)
    this.sin = new Float32Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      const th = (i / POINTS) * 2 * Math.PI
      this.fold[i] = fold(th)
      this.cos[i] = Math.cos(th)
      this.sin[i] = Math.sin(th)
    }
    this.feedback = document.createElement('canvas')
  }

  reset() {
    this.count = 0
    const fb = this.feedbackCtx
    if (fb) fb.clearRect(0, 0, this.feedback.width, this.feedback.height)
  }

  /**
   * Advances the tunnel by dt seconds and spawns new rings from `input`.
   * `lifetime` is how long a ring takes to reach the edge; `spin` is the
   * rotation rate of newly born rings in rad/s.
   */
  update(dt: number, input: TunnelInput, lifetime: number, spin: number, spawnInterval: number) {
    this.time += dt
    this.angle += dt * spin
    this.beatGlow = Math.max(input.beat, this.beatGlow * Math.exp(-dt * 6))
    const step = dt / lifetime
    for (let i = 0; i < this.count; i++) {
      const r = this.ring(i)
      r.u += step
      r.age += dt
    }

    while (this.count > 0 && this.ring(0).u >= 1) {
      this.count--
    }
    this.spawnAcc += dt
    let spawned = 0
    while (this.spawnAcc >= spawnInterval || this.count === 0) {
      this.spawnAcc = Math.max(0, this.spawnAcc - spawnInterval)
      // Spread rings born in one frame so a slow frame doesn't stack them.
      this.spawn(input, this.spawnAcc / lifetime + spawned * 1e-4)
      spawned++
    }
    // The newest string stays live: it tracks the current sound until the next is born.
    this.capture(this.rings[this.head], input)
  }

  /** i-th live ring, oldest first. */
  private ring(i: number): Ring {
    return this.rings[(this.head - this.count + 1 + i + MAX_RINGS * 2) % MAX_RINGS]
  }

  private spawn(input: TunnelInput, u: number) {
    if (this.count === MAX_RINGS) this.count--
    this.head = (this.head + 1) % MAX_RINGS
    this.count++
    const r = this.rings[this.head]
    r.u = u
    r.age = 0
    r.beat = 0
    r.angle = this.angle
    this.capture(r, input)
  }

  private capture(r: Ring, input: TunnelInput) {
    r.bands.set(input.bands)
    r.level = input.level
    r.lobes = input.lobes
    r.temperature = input.temperature
    r.beat = Math.max(r.beat, input.beat)
    const b = input.bands
    const from = Math.floor(b.length * 0.6)
    let t = 0
    for (let i = from; i < b.length; i++) t += b[i]
    r.treble = t / (b.length - from)
    r.gradient = null
  }

  /** Conic gradient for a ring: hue from spectrum position, lightness from that band's energy. */
  private gradientFor(ctx: CanvasRenderingContext2D, r: Ring): CanvasGradient {
    const g = ctx.createConicGradient(0, 0, 0)
    const n = FOLDS * 2 * STOPS_PER_HALF
    const bands = r.bands
    for (let j = 0; j <= n; j++) {
      const p = j / n
      const pos = fold(p * 2 * Math.PI)
      const level = bands[Math.min(bands.length - 1, Math.round(pos * (bands.length - 1)))]
      g.addColorStop(p, neon(r.temperature, pos, 48 + 30 * level))
    }
    return g
  }

  render(ctx: CanvasRenderingContext2D) {
    const canvas = ctx.canvas
    const W = canvas.width
    const H = canvas.height
    const cx = W / 2
    const cy = H / 2
    const minDim = Math.min(W, H)
    const reach = Math.hypot(W, H) / 2
    const hole = minDim * 0.075
    const px = minDim / 900

    const fb = this.feedback
    if (fb.width !== W || fb.height !== H) {
      fb.width = W
      fb.height = H
      this.feedbackCtx = fb.getContext('2d')
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    // Feedback: last frame, zoomed outward and turned a touch, fading.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(0.004 * Math.sin(this.time * 0.37))
    const zoom = 1.016 + 0.02 * this.beatGlow
    ctx.scale(zoom, zoom)
    ctx.globalAlpha = 0.5
    ctx.drawImage(fb, -cx, -cy, W, H)
    ctx.restore()

    ctx.globalCompositeOperation = 'lighter'
    ctx.lineJoin = 'round'
    const bandsMax = this.rings[0].bands.length - 1
    for (let i = 0; i < this.count; i++) {
      const r = this.ring(i)
      const u = r.u
      if (u >= 1) continue
      const alpha = smooth(0, 0.05, u) * (1 - smooth(0.72, 1, u))
      if (alpha <= 0.002) continue
      const base = hole + (reach * 1.08 - hole) * Math.pow(u, 1.8)
      const shape = 0.16 + 0.2 * u
      const intensity = (0.45 + 0.55 * r.level) * (1 + 0.6 * r.beat)
      // Plucked-string vibration: a standing wave whose mode is the note's
      // lobe count, ringing and decaying with age, plus a faster treble shimmer.
      const pluck = Math.exp(-r.age * 1.1) * (0.35 + r.level + 0.8 * r.beat)
      const swing = 0.06 * pluck * Math.cos(2 * Math.PI * 1.6 * r.age)
      const shimmer = 0.018 * r.treble * Math.exp(-r.age * 0.6)
      const shimmerMode = 2 * r.lobes + 1
      const shimmerPhase = 7 * r.age

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(r.angle + u * 0.6)
      ctx.beginPath()
      for (let p = 0; p < POINTS; p++) {
        const pos = this.fold[p] * bandsMax
        const k = pos | 0
        const f = pos - k
        const v = r.bands[k] * (1 - f) + r.bands[Math.min(bandsMax, k + 1)] * f
        const th = (p / POINTS) * 2 * Math.PI
        const rad =
          base *
          (1 +
            shape * (v - 0.4) +
            swing * Math.sin(r.lobes * th) +
            shimmer * Math.sin(shimmerMode * th - shimmerPhase))
        const x = rad * this.cos[p]
        const y = rad * this.sin[p]
        if (p === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      r.gradient ??= this.gradientFor(ctx, r)
      ctx.strokeStyle = r.gradient
      // A thin bright string with a narrow halo.
      ctx.globalAlpha = 0.14 * alpha * intensity
      ctx.lineWidth = (3 + 3 * u) * px
      ctx.stroke()
      ctx.globalAlpha = Math.min(1, alpha * intensity)
      ctx.lineWidth = (0.9 + 0.9 * u) * px
      ctx.stroke()
      ctx.restore()
    }

    // The hollow core.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, hole * 1.5)
    core.addColorStop(0, 'rgba(0,0,0,1)')
    core.addColorStop(0.6, 'rgba(0,0,0,1)')
    core.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = core
    ctx.fillRect(cx - hole * 1.5, cy - hole * 1.5, hole * 3, hole * 3)

    // Vignette, which also keeps the feedback from saturating at the edges.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const vig = ctx.createRadialGradient(cx, cy, minDim * 0.35, cx, cy, reach)
    vig.addColorStop(0, 'rgba(0,0,0,0)')
    vig.addColorStop(1, 'rgba(0,0,0,0.5)')
    ctx.fillStyle = vig
    ctx.fillRect(0, 0, W, H)

    const fctx = this.feedbackCtx
    if (fctx) {
      fctx.globalCompositeOperation = 'copy'
      fctx.drawImage(canvas, 0, 0)
    }
  }
}
