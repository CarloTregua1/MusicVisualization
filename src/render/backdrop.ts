import { neonHue } from './neon'

const PARTICLES = 240
const BLOBS = 3

export interface BackdropInput {
  temperature: number
  /** Overall loudness 0..1. */
  level: number
  /** Decaying onset glow 0..1. */
  beat: number
}

/**
 * Animated background in the complementary hue of the strings, kept near
 * black so the neon always reads on top of it: drifting nebula clouds, a deep tunnel
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

  /** Complementary hue of the strings' mid-spectrum colour at this temperature. */
  static hue(temperature: number): number {
    return (neonHue(temperature, 0.5) + 180) % 360
  }

  draw(ctx: CanvasRenderingContext2D, dt: number, { temperature, level, beat }: BackdropInput) {
    this.time += dt
    const t = this.time
    const { width: W, height: H } = ctx.canvas
    const cx = W / 2
    const cy = H / 2
    const minDim = Math.min(W, H)
    const reach = Math.hypot(W, H) / 2
    const px = minDim / 900
    const hue = Backdrop.hue(temperature)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = `hsl(${hue.toFixed(1)}, 45%, 3%)`
    ctx.fillRect(0, 0, W, H)

    // Nebula: large soft clouds orbiting slowly, breathing with the music.
    ctx.globalCompositeOperation = 'lighter'
    for (let k = 0; k < BLOBS; k++) {
      const a = t * (0.035 + k * 0.012) + k * 2.1
      const bx = cx + Math.cos(a) * minDim * (0.28 + 0.08 * k)
      const by = cy + Math.sin(a * 1.3) * minDim * (0.22 + 0.05 * k)
      const r = minDim * (0.55 + 0.1 * Math.sin(t * 0.21 + k * 1.7)) * (1 + 0.15 * beat)
      const light = 5 + 4 * level + 3 * beat
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, r)
      g.addColorStop(0, `hsla(${(hue + (k - 1) * 24).toFixed(1)}, 70%, ${light.toFixed(1)}%, 0.3)`)
      g.addColorStop(1, `hsla(${(hue + (k - 1) * 24).toFixed(1)}, 85%, ${light.toFixed(1)}%, 0)`)
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
      ctx.strokeStyle = `hsl(${(hue + this.hueJitter[i]).toFixed(0)}, 90%, 66%)`
      ctx.globalAlpha = (0.06 + 0.3 * Math.min(1, z1 * 1.4)) * tw
      ctx.lineWidth = this.size[i] * (0.5 + 1.5 * z1) * px
      ctx.beginPath()
      ctx.moveTo(cx + c * r0, cy + s * r0)
      ctx.lineTo(cx + c * (r1 + px), cy + s * (r1 + px))
      ctx.stroke()
    }

    // The tunnel mouth: depth falling off to near-black at the centre.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const mouth = ctx.createRadialGradient(cx, cy, 0, cx, cy, minDim * 0.3)
    mouth.addColorStop(0, `hsla(${hue.toFixed(1)}, 60%, 2%, 0.95)`)
    mouth.addColorStop(1, `hsla(${hue.toFixed(1)}, 60%, 2%, 0)`)
    ctx.fillStyle = mouth
    ctx.fillRect(cx - minDim * 0.3, cy - minDim * 0.3, minDim * 0.6, minDim * 0.6)
  }
}
