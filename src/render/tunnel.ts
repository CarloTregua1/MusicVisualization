import { neon } from './neon'

const MAX_RINGS = 160
const POINTS = 144
/** Kaleidoscope symmetry: the spectrum is mirrored this many times around each ring. */
const FOLDS = 6
const SPAWN_INTERVAL = 1 / 40
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
 * A neon tunnel of concentric spectral shapes. Each ring is a snapshot of
 * the spectrum taken when it was born at the hollow centre; rings then
 * travel outward with perspective, so the innermost ring is always the sound
 * playing now. A feedback pass (the previous frame redrawn slightly zoomed
 * and rotated) leaves self-similar trails, in the spirit of MilkDrop.
 */
export class Tunnel {
  private readonly rings: Ring[]
  private head = 0
  private count = 0
  private spawnAcc = 0
  private angle = 0
  private time = 0
  private beatGlow = 0
  private lastTemperature = 0.5
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
  update(dt: number, input: TunnelInput, lifetime: number, spin: number) {
    this.time += dt
    this.angle += dt * spin
    this.beatGlow = Math.max(input.beat, this.beatGlow * Math.exp(-dt * 6))
    this.lastTemperature = input.temperature
    const step = dt / lifetime
    for (let i = 0; i < this.count; i++) this.ring(i).u += step

    while (this.count > 0 && this.ring(0).u >= 1) {
      this.count--
    }
    this.spawnAcc += dt
    let spawned = 0
    while (this.spawnAcc >= SPAWN_INTERVAL) {
      this.spawnAcc -= SPAWN_INTERVAL
      // Spread rings born in one frame so a slow frame doesn't stack them.
      this.spawn(input, this.spawnAcc / lifetime + spawned * 1e-4)
      spawned++
    }
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
    r.bands.set(input.bands)
    r.u = u
    r.level = input.level
    r.lobes = input.lobes
    r.temperature = input.temperature
    r.beat = input.beat
    r.angle = this.angle
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
    ctx.globalAlpha = 0.8
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
      const wobble = 0.045 * (0.3 + r.level)
      const intensity = (0.35 + 0.65 * r.level) * (1 + 0.7 * r.beat)

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
        const rad = base * (1 + shape * (v - 0.4) + wobble * Math.sin(r.lobes * th))
        const x = rad * this.cos[p]
        const y = rad * this.sin[p]
        if (p === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      r.gradient ??= this.gradientFor(ctx, r)
      ctx.strokeStyle = r.gradient
      // Wide faint stroke for the glow, then a thin bright core.
      ctx.globalAlpha = 0.16 * alpha * intensity
      ctx.lineWidth = (3 + 14 * u) * px * (1 + r.beat)
      ctx.stroke()
      ctx.globalAlpha = Math.min(1, 0.95 * alpha * intensity)
      ctx.lineWidth = (0.9 + 2.6 * u) * px
      ctx.stroke()
      ctx.restore()
    }

    // The hollow core, with a thin pulsing rim.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, hole * 1.5)
    core.addColorStop(0, 'rgba(0,0,0,1)')
    core.addColorStop(0.6, 'rgba(0,0,0,1)')
    core.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = core
    ctx.fillRect(cx - hole * 1.5, cy - hole * 1.5, hole * 3, hole * 3)
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = neon(this.lastTemperature, 0.15, 70)
    ctx.globalAlpha = 0.25 + 0.6 * this.beatGlow
    ctx.lineWidth = 1.2 * px
    ctx.beginPath()
    ctx.arc(cx, cy, hole * 0.92, 0, Math.PI * 2)
    ctx.stroke()

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
