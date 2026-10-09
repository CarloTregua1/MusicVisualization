import { neon } from './neon'

/** Upper bound on fibres alive at once (~2.5 s of history at the emission rate). */
const MAX_FIBERS = 260
const POINTS = 180
/** Fibres emitted per second while sound is present. */
const EMIT_RATE = 90
/** Bloom is computed at this fraction of the canvas size (downscale = cheap blur). */
const BLOOM_SCALE = 0.25
/** Camera-space depths: fibres are born at Z_FAR (the hollow) and die past Z_NEAR. */
const Z_FAR = 6
const Z_NEAR = 0.35
/** Colour stops per half turn of a fibre's conic gradient. */
const STOPS_HALF = 12

interface Fiber {
  bands: Float32Array
  level: number
  /** Onset strength at birth, 0..1: taller, brighter ridges. */
  onset: number
  temperature: number
  /** Depth in camera space. */
  z: number
  /** Small per-fibre variation so neighbouring fibres don't coincide exactly. */
  jitter: number
  /** Slowly varying phase for the fine thread detail: neighbours stay similar, so they bundle. */
  phase: number
  /** Treble energy, scales the fine detail. */
  treble: number
  gradient: CanvasGradient | null
}

export interface FiberInput {
  /** Band levels 0..1, bass first. Copied. */
  bands: Float32Array
  /** Overall loudness 0..1. */
  level: number
  /** 0 = cold, 1 = hot. */
  temperature: number
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Light-painting tunnel. Each fibre is a thin glowing loop holding one
 * moment of the spectrum around the circle (bass at the bottom, treble at
 * the top, mirrored left/right). Fibres are emitted only while there is
 * sound, born at the far end around the hollow, and fly toward the camera,
 * so the innermost fibre is always the latest sound. Loud bands push the
 * fibre inward and toward the viewer, forming 3D ridges; overlapping fibres
 * add up to white-hot crests. A short feedback trail adds motion blur.
 */
export class FiberTunnel {
  private readonly fibers: Fiber[]
  private head = -1
  private count = 0
  private emitAcc = 0
  private time = 0
  private serial = 0
  private readonly pos: Float32Array
  private readonly cos: Float32Array
  private readonly sin: Float32Array
  private readonly layer: HTMLCanvasElement
  private readonly trail: HTMLCanvasElement
  private readonly bloom: HTMLCanvasElement
  private layerCtx: CanvasRenderingContext2D | null = null
  private trailCtx: CanvasRenderingContext2D | null = null
  private bloomCtx: CanvasRenderingContext2D | null = null

  constructor(bandCount: number) {
    this.fibers = Array.from({ length: MAX_FIBERS }, () => ({
      bands: new Float32Array(bandCount),
      level: 0,
      onset: 0,
      temperature: 0.5,
      z: Z_FAR,
      jitter: 0,
      phase: 0,
      treble: 0,
      gradient: null,
    }))
    this.pos = new Float32Array(POINTS)
    this.cos = new Float32Array(POINTS)
    this.sin = new Float32Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      const th = (i / POINTS) * 2 * Math.PI
      this.cos[i] = Math.cos(th)
      this.sin[i] = Math.sin(th)
      // Canvas y points down, so θ = π/2 is the bottom: bass there, treble at the top.
      const fromBottom = Math.abs(((th - Math.PI / 2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
      this.pos[i] = fromBottom / Math.PI
    }
    this.layer = document.createElement('canvas')
    this.trail = document.createElement('canvas')
    this.bloom = document.createElement('canvas')
  }

  reset() {
    this.count = 0
    this.trailCtx?.clearRect(0, 0, this.trail.width, this.trail.height)
  }

  /** i-th live fibre, oldest (nearest the camera) first. */
  private fiber(i: number): Fiber {
    return this.fibers[(this.head - this.count + 1 + i + MAX_FIBERS * 2) % MAX_FIBERS]
  }

  /**
   * Advances by dt. Fibres are emitted only while `sounding`; an `onset` > 0
   * marks the next fibre as an onset ridge. `lifetime` is the travel time
   * from the hollow to the camera.
   */
  update(dt: number, input: FiberInput, sounding: boolean, onset: number, lifetime: number) {
    this.time += dt
    // Travel in log-depth so on-screen spacing stays even as fibres approach.
    const k = Math.log(Z_FAR / Z_NEAR) / lifetime
    for (let i = 0; i < this.count; i++) {
      const f = this.fiber(i)
      f.z *= Math.exp(-k * dt)
    }
    while (this.count > 0 && this.fiber(0).z <= Z_NEAR) this.count--

    if (!sounding) {
      this.emitAcc = 0
      return
    }
    this.emitAcc += dt
    let first = true
    while (this.emitAcc >= 1 / EMIT_RATE) {
      this.emitAcc -= 1 / EMIT_RATE
      // Fibres from one long frame are spread in depth by their emission time.
      this.emit(input, first ? onset : 0, Z_FAR * Math.exp(-k * this.emitAcc))
      first = false
    }
  }

  private emit(input: FiberInput, onset: number, z: number) {
    if (this.count === MAX_FIBERS) this.count--
    this.head = (this.head + 1) % MAX_FIBERS
    this.count++
    const f = this.fibers[this.head]
    // Light blur across bands keeps the ridges organic rather than stepped.
    const b = input.bands
    const n = b.length
    for (let i = 0; i < n; i++) {
      f.bands[i] = 0.25 * b[Math.max(0, i - 1)] + 0.5 * b[i] + 0.25 * b[Math.min(n - 1, i + 1)]
    }
    f.level = input.level
    f.onset = onset
    f.temperature = input.temperature
    f.z = z
    let tr = 0
    for (let i = Math.floor(n * 0.55); i < n; i++) tr += f.bands[i]
    f.treble = tr / (n - Math.floor(n * 0.55))
    f.phase = this.serial * 0.035 + this.time * 0.25
    // Low-discrepancy jitter: consecutive fibres get well-spread offsets.
    f.jitter = ((this.serial++ * 0.618034) % 1) - 0.5
    f.gradient = null
  }

  /** Conic gradient in the fibre's own frame: hue by spectrum position, ridges brighter. */
  private gradient(ctx: CanvasRenderingContext2D, f: Fiber): CanvasGradient {
    const g = ctx.createConicGradient(0, 0, 0)
    const n = STOPS_HALF * 2
    const last = f.bands.length - 1
    for (let j = 0; j <= n; j++) {
      const th = (j / n) * 2 * Math.PI
      const pos = Math.abs(((th - Math.PI / 2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) / Math.PI
      const v = f.bands[Math.round(pos * last)]
      g.addColorStop(j / n, neon(f.temperature, pos, 46 + 34 * v + 12 * f.onset))
    }
    return g
  }

  private ensureLayers(W: number, H: number) {
    for (const c of [this.layer, this.trail]) {
      if (c.width !== W || c.height !== H) {
        c.width = W
        c.height = H
      }
    }
    const bw = Math.max(1, Math.round(W * BLOOM_SCALE))
    const bh = Math.max(1, Math.round(H * BLOOM_SCALE))
    if (this.bloom.width !== bw || this.bloom.height !== bh) {
      this.bloom.width = bw
      this.bloom.height = bh
    }
    this.layerCtx ??= this.layer.getContext('2d')
    this.trailCtx ??= this.trail.getContext('2d')
    this.bloomCtx ??= this.bloom.getContext('2d')
  }

  /** Draws the fibre layer onto `ctx`, over whatever background is already there. */
  render(ctx: CanvasRenderingContext2D) {
    const W = ctx.canvas.width
    const H = ctx.canvas.height
    this.ensureLayers(W, H)
    const lc = this.layerCtx
    const tc = this.trailCtx
    const bc = this.bloomCtx
    if (!lc || !tc || !bc) return
    const cx = W / 2
    const cy = H / 2
    const reach = Math.hypot(W, H) / 2
    const px = Math.min(W, H) / 900
    // Focal length: a plain fibre at Z_NEAR just overfills the screen.
    const focal = reach * 1.15 * Z_NEAR

    lc.setTransform(1, 0, 0, 1, 0, 0)
    lc.globalCompositeOperation = 'source-over'
    lc.globalAlpha = 1
    lc.clearRect(0, 0, W, H)

    // Motion blur: last frame, pushed outward a little and faded.
    lc.save()
    lc.translate(cx, cy)
    lc.scale(1.025, 1.025)
    lc.globalAlpha = 0.55
    lc.drawImage(this.trail, -cx, -cy, W, H)
    lc.restore()

    // The tunnel bends slowly: ring centres drift sideways with depth.
    const bendX = 0.55 * Math.sin(this.time * 0.13) + 0.2 * Math.sin(this.time * 0.31)
    const bendY = 0.4 * Math.sin(this.time * 0.09 + 1.3)

    lc.globalCompositeOperation = 'lighter'
    lc.lineJoin = 'round'
    const last = this.fibers[0].bands.length - 1
    for (let i = 0; i < this.count; i++) {
      const f = this.fiber(i)
      const z = f.z
      // Fade in out of the hollow, fade out as it rushes past the camera.
      const alpha = smooth(Z_FAR, Z_FAR * 0.8, z) * smooth(Z_NEAR, Z_NEAR * 1.8, z) * (0.35 + 0.65 * f.level)
      if (alpha < 0.01) continue

      const d = (z - Z_NEAR) / (Z_FAR - Z_NEAR)
      const wx = bendX * d * d
      const wy = bendY * d * d
      const ox = cx + (focal * wx) / z
      const oy = cy + (focal * wy) / z
      const amp = (0.35 + 0.65 * f.level) * (1 + 0.9 * f.onset)
      const wob = 0.02 * Math.sin(this.time * 1.7 + f.jitter * 9)
      // Fine thread detail: a few incommensurate ripples whose phases drift
      // slowly from fibre to fibre, so neighbours wiggle together in bundles.
      const fine = (0.012 + 0.05 * f.treble) * (0.5 + 0.5 * amp)
      const ph = f.phase

      lc.setTransform(1, 0, 0, 1, ox, oy)
      lc.beginPath()
      for (let p = 0; p < POINTS; p++) {
        const q = this.pos[p] * last
        const k0 = q | 0
        const t = q - k0
        const v = f.bands[k0] * (1 - t) + f.bands[Math.min(last, k0 + 1)] * t
        const th = (p / POINTS) * 2 * Math.PI
        const ripple =
          0.45 * Math.sin(7 * th + ph * 3.1) +
          0.3 * Math.sin(13 * th - ph * 4.7 + 1.3) +
          0.17 * Math.sin(23 * th + ph * 6.3 + 2.1) +
          0.08 * Math.sin(41 * th - ph * 8.9 + 0.4)
        // Ridges: loud bands bulge deep into the tunnel and lean toward the camera.
        const raw = 1 - 0.78 * v * amp + wob + 0.025 * f.jitter + fine * ripple
        // Soft floor: a huge onset can't push the fibre through the hollow.
        const r = raw > 0.45 ? raw : 0.3 + 0.15 * Math.exp((raw - 0.45) / 0.15)
        const lean = Math.min(0.95 * v * amp, 0.8) * Math.min(1, z / 2)
        const zp = Math.max(z * 0.5, Z_NEAR * 0.6, z - lean)
        const s = focal / zp
        const x = r * this.cos[p] * s + (focal * wx) / zp - (focal * wx) / z
        const y = r * this.sin[p] * s + (focal * wy) / zp - (focal * wy) / z
        if (p === 0) lc.moveTo(x, y)
        else lc.lineTo(x, y)
      }
      lc.closePath()
      f.gradient ??= this.gradient(lc, f)
      lc.strokeStyle = f.gradient
      lc.globalAlpha = Math.min(1, alpha * (0.5 + 0.5 * f.onset))
      lc.lineWidth = Math.max(0.5, (0.75 * px) / Math.pow(z, 0.6)) * (1 + 0.5 * f.onset)
      lc.stroke()
    }

    lc.setTransform(1, 0, 0, 1, 0, 0)
    tc.globalCompositeOperation = 'copy'
    tc.globalAlpha = 1
    tc.drawImage(this.layer, 0, 0)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.drawImage(this.layer, 0, 0)

    // Bloom: a downscaled copy, stretched back up (bilinear = blur) and added.
    bc.setTransform(1, 0, 0, 1, 0, 0)
    bc.globalCompositeOperation = 'copy'
    bc.imageSmoothingEnabled = true
    bc.drawImage(this.layer, 0, 0, this.bloom.width, this.bloom.height)
    ctx.imageSmoothingEnabled = true
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.55
    ctx.drawImage(this.bloom, 0, 0, W, H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
