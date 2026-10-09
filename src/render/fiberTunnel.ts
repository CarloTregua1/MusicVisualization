import { RollCamera } from './camera'

/** Upper bound on fibres alive at once. */
const MAX_FIBERS = 200
const POINTS = 128
/** Each fibre is stroked as this many arcs, so its colour can follow the spectrum around it. */
const SEGMENTS = 6
/** Fibres emitted per second while sound is present: calm, not a blizzard. */
const EMIT_RATE = 24
/** Camera-space depths: fibres are born at Z_FAR (the hollow) and die past Z_NEAR. */
const Z_FAR = 6
const Z_NEAR = 0.35
/** Time constant (s) of the spectrum smoothing between consecutive fibres: neighbours stack like contours. */
const COHERENCE = 0.1
/** Camera height above the tunnel axis: near fibres swing down into a floor. */
const CAMERA_HEIGHT = 0.5
/** Minimum on-screen gap between a fibre and the newer one inside it, as a fraction of their natural spacing. */
const MIN_GAP = 0.45
/** Bloom is computed at this fraction of the canvas size (downscale = cheap blur). */
const BLOOM_SCALE = 0.25

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
  /** Rotation of the spectrum mapping at birth: successive fibres turn, so the stack swirls. */
  turn: number
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
 * Fibre colour. Age drives the main ramp, as in the reference: the newest
 * fibre (the rim of the hollow) is white-hot pink, older ones cool through
 * purple and blue to teal. Tempo shifts the whole ramp colder or hotter, and
 * the fibre's position around the spectrum tints it, so frequencies still
 * read as different hues. Always fully saturated neon.
 */
function fiberColor(temperature: number, age: number, pos: number, energy: number, tint: number): string {
  const hue = 320 - 135 * age + (temperature - 0.5) * 110 + (pos - 0.5) * 36 + tint
  const light = Math.min(92, 52 + 28 * Math.pow(1 - age, 3) + 16 * energy)
  return `hsl(${(((hue % 360) + 360) % 360).toFixed(0)}, 100%, ${light.toFixed(0)}%)`
}

/**
 * Light-painting tunnel, modelled on the reference video. Each fibre is a
 * thin glowing loop holding one moment of the spectrum around the circle
 * (bass at the bottom, treble at the top, mirrored left/right). Fibres are
 * emitted only while there is sound, born at the far end around the hollow,
 * and drift slowly toward the camera, so the hollow's rim is always the
 * latest sound. Loud bands rise outward into tall peaked towers; the camera
 * looks slightly down the tunnel so older fibres form a floor below it.
 */
export class FiberTunnel {
  private readonly fibers: Fiber[]
  private head = -1
  private count = 0
  private emitAcc = 0
  private time = 0
  private serial = 0
  /** Decaying flash from onsets, brightens the whole structure. */
  private flash = 0
  /** Slow left/right camera roll; this frame's angle in radians. */
  private readonly roll = new RollCamera()
  private rollAngle = 0
  /** Spectrum smoothed over time; fibres are emitted from this, not the raw frame. */
  private smoothBands: Float32Array
  private readonly pos: Float32Array
  private readonly cos: Float32Array
  private readonly sin: Float32Array
  // This frame's fibre geometry (by live index) and per-point loudness.
  private readonly xs = new Float32Array(MAX_FIBERS * POINTS)
  private readonly ys = new Float32Array(MAX_FIBERS * POINTS)
  private readonly vs = new Float32Array(MAX_FIBERS * POINTS)
  /** Screen radius of the newer neighbour at each angle, for the no-crossing rule. */
  private readonly inner = new Float32Array(POINTS)
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
      turn: 0,
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
    this.smoothBands = new Float32Array(bandCount)
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
   * marks the next fibre as an onset ridge and flashes the structure.
   * `lifetime` is the drift time from the hollow to the camera.
   */
  update(dt: number, input: FiberInput, sounding: boolean, onset: number, lifetime: number) {
    this.time += dt
    this.rollAngle = this.roll.update(dt)
    this.flash = Math.max(onset, this.flash * Math.exp(-dt * 5))
    // Smooth the spectrum over time so consecutive fibres are near-identical
    // and stack into parallel contours; an onset breaks through halfway.
    const a = 1 - Math.exp(-dt / COHERENCE)
    const sb = this.smoothBands
    for (let i = 0; i < sb.length; i++) {
      const b = input.bands[i]
      sb[i] = onset > 0 ? sb[i] + (Math.max(sb[i], b) - sb[i]) * 0.5 : sb[i] + (b - sb[i]) * a
    }
    // Travel in log-depth so on-screen spacing stays even as fibres approach.
    const k = Math.log(Z_FAR / Z_NEAR) / lifetime
    const shrink = Math.exp(-k * dt)
    for (let i = 0; i < this.count; i++) this.fiber(i).z *= shrink
    while (this.count > 0 && this.fiber(0).z <= Z_NEAR) this.count--

    if (!sounding) {
      this.emitAcc = 0
      return
    }
    // An onset emits immediately, so the hit lands on its own fibre.
    if (onset > 0) {
      this.emit(input, onset, Z_FAR)
      this.emitAcc = 0
      return
    }
    this.emitAcc += dt
    while (this.emitAcc >= 1 / EMIT_RATE) {
      this.emitAcc -= 1 / EMIT_RATE
      this.emit(input, 0, Z_FAR * Math.exp(-k * this.emitAcc))
    }
  }

  private emit(input: FiberInput, onset: number, z: number) {
    if (this.count === MAX_FIBERS) this.count--
    this.head = (this.head + 1) % MAX_FIBERS
    this.count++
    const f = this.fibers[this.head]
    // Light blur across bands keeps the ridges organic rather than stepped.
    const b = this.smoothBands
    const n = b.length
    for (let i = 0; i < n; i++) {
      f.bands[i] = 0.25 * b[Math.max(0, i - 1)] + 0.5 * b[i] + 0.25 * b[Math.min(n - 1, i + 1)]
    }
    f.level = input.level
    f.onset = onset
    f.temperature = input.temperature
    f.z = z
    let tr = 0
    const from = Math.floor(n * 0.55)
    for (let i = from; i < n; i++) tr += f.bands[i]
    f.treble = tr / (n - from)
    f.phase = this.serial * 0.05 + this.time * 0.2
    // Slow, wandering rotation: breaks the mirror symmetry into a swirl.
    f.turn = 0.45 * Math.sin(this.time * 0.07) + 0.15 * Math.sin(this.time * 0.19 + 1)
    // Low-discrepancy jitter: consecutive fibres get well-spread offsets.
    f.jitter = ((this.serial++ * 0.618034) % 1) - 0.5
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

    // A soft trail: last frame, pushed outward a touch and faded.
    lc.save()
    lc.translate(cx, cy)
    lc.scale(1.006, 1.006)
    lc.globalAlpha = 0.12
    lc.drawImage(this.trail, -cx, -cy, W, H)
    lc.restore()

    // The camera sits above the tunnel axis (and drifts a little sideways), so
    // by perspective near fibres swing down into a floor while the far hollow
    // stays put; the view is aimed a touch up to keep the hollow framed.
    const camX = 0.12 * Math.sin(this.time * 0.11)
    const camY = CAMERA_HEIGHT + 0.08 * Math.sin(this.time * 0.08 + 1.3)
    const aimY = -0.06 * H

    lc.globalCompositeOperation = 'lighter'
    lc.lineJoin = 'round'
    lc.lineCap = 'round'
    const last = this.fibers[0].bands.length - 1
    const logSpan = Math.log(Z_FAR / Z_NEAR)
    const { xs, ys, vs, inner } = this

    // Geometry, newest (innermost) first. Each fibre is kept just outside the
    // newer one at every angle, so the stack never crosses: a tower on a fresh
    // fibre lifts every older fibre over it into a wall of nested contours.
    let innerS = 0
    for (let i = this.count - 1; i >= 0; i--) {
      const f = this.fiber(i)
      const z = f.z
      const amp = (0.4 + 0.6 * f.level) * (1 + 0.5 * f.onset)
      // A whisper of thread detail, shared by neighbours so it never looks noisy.
      const fine = (0.003 + 0.01 * f.treble) * amp
      const ph = f.phase
      const s = focal / z
      // Rotate the fibre's spectrum layout by its birth turn (in whole points).
      const shift = Math.round((f.turn / (2 * Math.PI)) * POINTS)
      const ox = cx - camX * s
      const oy = cy + aimY + camY * s
      const gap = i === this.count - 1 ? 0 : Math.max(1.1 * px, MIN_GAP * (s - innerS))
      const o = i * POINTS
      for (let p = 0; p < POINTS; p++) {
        const q = this.pos[(p + shift + POINTS * 4) % POINTS] * last
        const k0 = q | 0
        const t = q - k0
        const v = f.bands[k0] * (1 - t) + f.bands[Math.min(last, k0 + 1)] * t
        const th = (p / POINTS) * 2 * Math.PI
        const ripple = 0.6 * Math.sin(9 * th + ph * 3.1) + 0.4 * Math.sin(17 * th - ph * 4.7 + 1.3)
        // Loud bands rise outward into tall, peaked towers (v³ keeps all but the
        // loudest bands flat, so towers stand out from a calm floor).
        const r = 1 + 2.6 * v * v * v * amp - 0.08 * v + fine * ripple
        let rho = r * s
        if (i !== this.count - 1 && rho < inner[p] + gap) rho = inner[p] + gap
        inner[p] = rho
        xs[o + p] = ox + rho * this.cos[p]
        ys[o + p] = oy + rho * this.sin[p]
        vs[o + p] = v
      }
      innerS = s
    }

    // Camera roll: tilt the whole tunnel around the screen centre.
    const rc = Math.cos(this.rollAngle)
    const rs = Math.sin(this.rollAngle)
    lc.setTransform(rc, rs, -rs, rc, cx - cx * rc + cy * rs, cy - cx * rs - cy * rc)

    // Draw, oldest first.
    for (let i = 0; i < this.count; i++) {
      const f = this.fiber(i)
      const z = f.z
      // 0 = just born at the hollow, 1 = reaching the camera.
      const age = Math.log(Z_FAR / z) / logSpan
      const alpha = smooth(0, 0.03, age) * (1 - smooth(0.82, 1, age)) * (0.75 + 0.25 * f.level) * (1 + 0.4 * this.flash)
      if (alpha < 0.01) continue
      const shift = Math.round((f.turn / (2 * Math.PI)) * POINTS)
      const o = i * POINTS
      lc.globalAlpha = Math.min(1, alpha)
      // Crisp lines; fibres born on a hit are thicker accents.
      lc.lineWidth = Math.max(0.8, (1.0 * px) / Math.pow(z, 0.7)) * (1 + 0.8 * f.onset)
      // Each fibre gets its own slight hue, so neighbours stay distinguishable.
      const tint = f.jitter * 16
      for (let sg = 0; sg < SEGMENTS; sg++) {
        // Integer bounds: POINTS needn't be a multiple of SEGMENTS.
        const a = Math.round((sg * POINTS) / SEGMENTS)
        const b = Math.round(((sg + 1) * POINTS) / SEGMENTS)
        // Brightness follows this fibre's own loudness along the segment.
        let e = 0
        for (let p = a; p < b; p++) e += vs[o + (p % POINTS)]
        e = e / (b - a) + f.onset * 0.6 + this.flash * 0.3
        lc.strokeStyle = fiberColor(f.temperature, age, this.pos[(((a + b) >> 1) + shift + POINTS * 4) % POINTS], e, tint)
        lc.beginPath()
        lc.moveTo(xs[o + a], ys[o + a])
        for (let p = a + 1; p <= b; p++) {
          const idx = o + (p % POINTS)
          lc.lineTo(xs[idx], ys[idx])
        }
        lc.stroke()
      }
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
    ctx.globalAlpha = 0.28 + 0.25 * this.flash
    ctx.drawImage(this.bloom, 0, 0, W, H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
