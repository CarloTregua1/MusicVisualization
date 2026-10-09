const PARTICLES = 240
const BLOBS = 3

export interface BackdropInput {
  /** Background hue, degrees: chosen to contrast with the tubes. */
  hue: number
  /** Overall loudness 0..1. */
  level: number
  /** Decaying onset glow 0..1. */
  beat: number
  /** Background strength 0..1 (0 = near black, 1 = vivid). */
  strength: number
  /** Scene light 0..1: the background dims with it, so silence and blackouts go dark. */
  light: number
  /** Crater on screen, kept dark: centre and rim radius in px (radius 0 = screen centre fallback). */
  craterX: number
  craterY: number
  craterRadius: number
}

/**
 * Animated background in a hue that contrasts with the tubes (the caller
 * passes the complement of their average colour), saturated but darker than
 * them so the neon pops against it: drifting nebula clouds, a deep tunnel
 * mouth at the centre, and a field of particles streaming out of the tunnel
 * that speeds up with loudness and onsets.
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

  draw(
    ctx: CanvasRenderingContext2D,
    dt: number,
    { hue, level, beat, strength, light, craterX, craterY, craterRadius }: BackdropInput,
  ) {
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
    // Saturated but darker than the tubes, so they pop against it; dims with the light.
    const lit = 0.25 + 0.75 * light
    const base = (3 + 30 * strength) * lit
    const kx = craterRadius > 0 ? craterX : cx
    const ky = craterRadius > 0 ? craterY : cy

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = `hsl(${hs}, ${(45 + 45 * strength).toFixed(0)}%, ${(base * 0.55).toFixed(1)}%)`
    ctx.fillRect(0, 0, W, H)
    // A broad glow around the crater gives the field depth: brightest near it.
    {
      const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, reach * 1.1)
      g.addColorStop(0, `hsla(${hs}, 90%, ${(base * 1.25).toFixed(1)}%, 1)`)
      g.addColorStop(0.55, `hsla(${hs}, 85%, ${(base * 0.8).toFixed(1)}%, 0.6)`)
      g.addColorStop(1, `hsla(${hs}, 80%, ${(base * 0.55).toFixed(1)}%, 0)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }

    // Nebula: large soft clouds in neighbouring hues, orbiting slowly, breathing with the music.
    ctx.globalCompositeOperation = 'lighter'
    for (let k = 0; k < BLOBS; k++) {
      const a = t * (0.035 + k * 0.012) + k * 2.1
      const bx = cx + Math.cos(a) * minDim * (0.28 + 0.08 * k)
      const by = cy + Math.sin(a * 1.3) * minDim * (0.22 + 0.05 * k)
      const r = minDim * (0.55 + 0.1 * Math.sin(t * 0.21 + k * 1.7)) * (1 + 0.15 * beat)
      const l = (5 + 8 * level + 5 * beat) * lit
      const bh = (h + (k - 1) * 28).toFixed(1)
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, r)
      g.addColorStop(0, `hsla(${bh}, 90%, ${l.toFixed(1)}%, ${(0.1 + 0.3 * strength).toFixed(2)})`)
      g.addColorStop(1, `hsla(${bh}, 90%, ${l.toFixed(1)}%, 0)`)
      ctx.fillStyle = g
      ctx.fillRect(bx - r, by - r, r * 2, r * 2)
    }

    // Particles streaming out of the tunnel, drawn as short motion streaks.
    const boost = 0.25 + 0.9 * level + 2.2 * beat
    ctx.lineCap = 'round'
    for (let i = 0; i < PARTICLES; i++) {
      const z0 = this.z[i]
      const z1 = z0 + dt * this.speed[i] * boost
      this.z[i] = z1
      const r0 = minDim * 0.05 + reach * Math.pow(z0, 2.2)
      const r1 = minDim * 0.05 + reach * Math.pow(z1, 2.2)
      if (r1 > reach * 1.05) {
        this.respawn(i, Math.random() * 0.08)
        continue
      }
      const c = Math.cos(this.angle[i])
      const s = Math.sin(this.angle[i])
      const tw = 0.6 + 0.4 * Math.sin(t * 3 + this.twinkle[i])
      ctx.strokeStyle = `hsl(${(h + this.hueJitter[i]).toFixed(0)}, 90%, ${(40 + 25 * lit).toFixed(0)}%)`
      ctx.globalAlpha = (0.04 + 0.18 * Math.min(1, z1 * 1.4)) * tw
      ctx.lineWidth = this.size[i] * (0.5 + 1.5 * z1) * px
      ctx.beginPath()
      ctx.moveTo(cx + c * r0, cy + s * r0)
      ctx.lineTo(cx + c * (r1 + px), cy + s * (r1 + px))
      ctx.stroke()
    }

    // The crater stays dark, so it reads as a hollow and the dancer stands out.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const mr = craterRadius > 0 ? craterRadius * 1.6 : minDim * 0.3
    const mouth = ctx.createRadialGradient(kx, ky, 0, kx, ky, mr)
    mouth.addColorStop(0, `hsla(${hs}, 60%, 2%, 0.97)`)
    mouth.addColorStop(0.55, `hsla(${hs}, 60%, 2%, 0.9)`)
    mouth.addColorStop(1, `hsla(${hs}, 60%, 2%, 0)`)
    ctx.fillStyle = mouth
    ctx.fillRect(kx - mr, ky - mr, mr * 2, mr * 2)
  }
}
