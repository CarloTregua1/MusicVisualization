const PARTICLES = 240
const BLOBS = 3

/** Colour of the empty "sky" outside the tube field. */
const SKY = '#020203'

export interface BackdropInput {
  /** Background hue, degrees: chosen to contrast with the tubes. */
  hue: number
  /** Overall loudness 0..1. */
  level: number
  /** Decaying onset glow 0..1. */
  beat: number
  /** Brightness of the background colour 0..1 (0 = near black). */
  strength: number
  /** Saturation 0..1. */
  saturation: number
  /** Strength of the drifting nebula clouds 0..1. */
  clouds: number
  /** Amount of streaming particles 0..1. */
  particles: number
  /** Scene light 0..1: the background dims with it, so silence and blackouts go dark. */
  light: number
  /** Crater on screen, kept dark: centre and rim radius in px (radius 0 = screen centre fallback). */
  craterX: number
  craterY: number
  craterRadius: number
  /**
   * Outline of the tube field (screen space, before the camera roll), and the
   * roll it is drawn with. The colour is only drawn inside it, so it shows
   * through the gaps between tubes but never as flat colour around them.
   * Null = no tubes yet: nothing but the dark sky.
   */
  field: Path2D | null
  roll: number
  rollX: number
  rollY: number
}

/**
 * Animated background in a hue that contrasts with the tubes (the caller
 * passes the complement of their average colour), saturated but darker than
 * them so the neon pops against it. It is clipped to the tube field: outside
 * it the scene stays dark sky. Inside: a glow around the crater, drifting
 * nebula clouds, and particles streaming out of the crater; the crater
 * itself stays dark.
 */
export class Backdrop {
  private time = 0
  private readonly angle = new Float32Array(PARTICLES)
  private readonly z = new Float32Array(PARTICLES)
  private readonly speed = new Float32Array(PARTICLES)
  private readonly size = new Float32Array(PARTICLES)
  private readonly hueJitter = new Float32Array(PARTICLES)
  private readonly twinkle = new Float32Array(PARTICLES)

  constructor() {
    for (let i = 0; i < PARTICLES; i++) this.respawn(i, Math.random())
  }

  private respawn(i: number, z: number) {
    this.angle[i] = Math.random() * Math.PI * 2
    this.z[i] = z
    this.speed[i] = 0.08 + Math.random() * 0.14
    this.size[i] = 0.6 + Math.random() * 1.6
    this.hueJitter[i] = (Math.random() - 0.5) * 50
    this.twinkle[i] = Math.random() * Math.PI * 2
  }

  draw(ctx: CanvasRenderingContext2D, dt: number, input: BackdropInput) {
    const { hue, level, beat, strength, saturation, clouds, particles, light, craterX, craterY, craterRadius } = input
    this.time += dt
    const t = this.time
    const { width: W, height: H } = ctx.canvas
    const cx = W / 2
    const cy = H / 2
    const minDim = Math.min(W, H)
    const reach = Math.hypot(W, H) / 2
    const px = minDim / 900
    const h = ((hue % 360) + 360) % 360
    const hs = h.toFixed(1)
    const sat = (100 * saturation).toFixed(0)
    // Saturated but darker than the tubes, so they pop against it; dims with the light.
    const lit = 0.25 + 0.75 * light
    const base = (3 + 30 * strength) * lit
    const kx = craterRadius > 0 ? craterX : cx
    const ky = craterRadius > 0 ? craterY : cy

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = SKY
    ctx.fillRect(0, 0, W, H)

    // Particles always advance, even when hidden, so they don't bunch up.
    const boost = 0.25 + 0.9 * level + 2.2 * beat
    for (let i = 0; i < PARTICLES; i++) {
      this.z[i] += dt * this.speed[i] * boost
      if (minDim * 0.05 + reach * Math.pow(this.z[i], 2.2) > reach * 1.05) this.respawn(i, Math.random() * 0.08)
    }
    if (!input.field) return

    // Only inside the tube field: clip with the same camera roll as the tubes.
    ctx.save()
    const c0 = Math.cos(input.roll)
    const s0 = Math.sin(input.roll)
    ctx.setTransform(c0, s0, -s0, c0, input.rollX - input.rollX * c0 + input.rollY * s0, input.rollY - input.rollX * s0 - input.rollY * c0)
    ctx.clip(input.field, 'nonzero')
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    ctx.fillStyle = `hsl(${hs}, ${sat}%, ${(base * 0.55).toFixed(1)}%)`
    ctx.fillRect(0, 0, W, H)
    // A broad glow around the crater gives the field depth: brightest near it.
    {
      const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, reach * 1.1)
      g.addColorStop(0, `hsla(${hs}, ${sat}%, ${(base * 1.25).toFixed(1)}%, 1)`)
      g.addColorStop(0.55, `hsla(${hs}, ${sat}%, ${(base * 0.8).toFixed(1)}%, 0.6)`)
      g.addColorStop(1, `hsla(${hs}, ${sat}%, ${(base * 0.55).toFixed(1)}%, 0)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }

    // Nebula: large soft clouds in neighbouring hues, orbiting slowly, breathing with the music.
    if (clouds > 0) {
      ctx.globalCompositeOperation = 'lighter'
      for (let k = 0; k < BLOBS; k++) {
        const a = t * (0.035 + k * 0.012) + k * 2.1
        const bx = cx + Math.cos(a) * minDim * (0.28 + 0.08 * k)
        const by = cy + Math.sin(a * 1.3) * minDim * (0.22 + 0.05 * k)
        const r = minDim * (0.55 + 0.1 * Math.sin(t * 0.21 + k * 1.7)) * (1 + 0.15 * beat)
        const l = (5 + 8 * level + 5 * beat) * lit
        const bh = (h + (k - 1) * 28).toFixed(1)
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, r)
        g.addColorStop(0, `hsla(${bh}, ${sat}%, ${l.toFixed(1)}%, ${(0.4 * clouds).toFixed(2)})`)
        g.addColorStop(1, `hsla(${bh}, ${sat}%, ${l.toFixed(1)}%, 0)`)
        ctx.fillStyle = g
        ctx.fillRect(bx - r, by - r, r * 2, r * 2)
      }
    }

    // Particles streaming out of the crater, drawn as short motion streaks.
    if (particles > 0) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      const shown = Math.round(PARTICLES * Math.min(1, particles))
      for (let i = 0; i < shown; i++) {
        const z1 = this.z[i]
        const z0 = Math.max(0, z1 - dt * this.speed[i] * boost)
        const r0 = minDim * 0.05 + reach * Math.pow(z0, 2.2)
        const r1 = minDim * 0.05 + reach * Math.pow(z1, 2.2)
        const c = Math.cos(this.angle[i])
        const s = Math.sin(this.angle[i])
        const tw = 0.6 + 0.4 * Math.sin(t * 3 + this.twinkle[i])
        ctx.strokeStyle = `hsl(${(h + this.hueJitter[i]).toFixed(0)}, ${sat}%, ${(40 + 25 * lit).toFixed(0)}%)`
        ctx.globalAlpha = (0.04 + 0.18 * Math.min(1, z1 * 1.4)) * tw * Math.min(1.5, particles * 1.5)
        ctx.lineWidth = this.size[i] * (0.5 + 1.5 * z1) * px
        ctx.beginPath()
        ctx.moveTo(kx + c * r0, ky + s * r0)
        ctx.lineTo(kx + c * (r1 + px), ky + s * (r1 + px))
        ctx.stroke()
      }
    }

    // The crater stays dark, so it reads as a hollow and the dancer stands out.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const mr = craterRadius > 0 ? craterRadius * 1.6 : minDim * 0.3
    const mouth = ctx.createRadialGradient(kx, ky, 0, kx, ky, mr)
    mouth.addColorStop(0, SKY)
    mouth.addColorStop(0.55, 'rgba(2,2,3,0.92)')
    mouth.addColorStop(1, 'rgba(2,2,3,0)')
    ctx.fillStyle = mouth
    ctx.fillRect(kx - mr, ky - mr, mr * 2, mr * 2)
    ctx.restore()
  }
}
