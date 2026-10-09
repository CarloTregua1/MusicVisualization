import { RollCamera } from './camera'

/** Upper bound on tubes alive at once (15/s × the longest lifetime, with room to spare). */
const MAX_TUBES = 160
const POINTS = 160
/** Each tube is shaded in this many arcs, so its lighting and colour vary along it. */
const SEGMENTS = 6
/** Tubes born per second: each spends 1/TUBE_RATE s developing as the white innermost tube. */
const TUBE_RATE = 15
/** Camera-space depths: tubes develop at Z_FAR (the hollow) and die past Z_NEAR. */
const Z_FAR = 3.3
const Z_NEAR = 0.35
/** Time constant (s) of the spectrum smoothing, so consecutive tubes stack coherently. */
const COHERENCE = 0.06
/** Camera height relative to the tunnel axis (negative = below), as in the reference's low view. */
const CAMERA_HEIGHT = -0.4
/** Vertical aim offset, as a fraction of screen height, keeping the hollow framed. */
const AIM = 0.05
/** World radius of a tube's cross-section, in tunnel radii. */
const TUBE_RADIUS = 0.008
/** Height of the tallest walls, in tunnel radii. Walls grow straight up. */
const WALL_HEIGHT = 1.5
/** Walls rise only where a band beats the mean of its ±WALL_SPAN neighbours (a spectral peak). */
const WALL_SPAN = 3
/** A band must beat its neighbours by this much before any wall rises… */
const WALL_MIN_CONTRAST = 0.02
/** …and by this much (beyond the minimum) for a full-height wall. */
const WALL_CONTRAST = 0.12
/** Bell weights used to spread each peak over its neighbours, so walls are rounded curtains. */
const WALL_SPREAD = [1, 3, 4, 3, 1]
/** Small waves along each tube, driven by loudness: how many around the loop, and their height. */
const WAVE_COUNT = 13
const WAVE_HEIGHT = 0.3
/** After its development, a tube fades from white to its colour over this long (s). */
const COOL_TIME = 0.12
/** Light from the white tube falls off over this distance (tunnel radii). */
const LIGHT_FALLOFF = 3.4
/** How quickly the scene light follows the music (s): silence goes dark almost at once. */
const LIGHT_RESPONSE = 0.08
/** Light that remains when the white tube is dark: practically none. */
const AMBIENT = 0.05
/** Bloom is computed at this fraction of the canvas size (downscale = cheap blur). */
const BLOOM_SCALE = 0.25

interface Tube {
  bands: Float32Array
  /** Wall lift per band, 0..1: how strongly each band is a loud spectral peak. */
  peaks: Float32Array
  level: number
  /** Onset strength during development, 0..1: taller walls. */
  onset: number
  temperature: number
  /** Depth in camera space. */
  z: number
  /** Seconds since birth. Development lasts 1/TUBE_RATE s; then the tube cools and travels. */
  age: number
  /** Small per-tube variation so neighbouring tubes don't coincide exactly. */
  jitter: number
  /** Rotation of the spectrum layout: successive tubes turn slowly, so the stack swirls. */
  turn: number
  /** Phase of the small waves; drifts slowly from tube to tube so neighbours stay coherent. */
  wave: number
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
 * Tube colour. Depth drives the hue ramp, as in the reference: tubes just
 * out of development are pink, older ones cool through purple and blue to
 * teal. Tempo shifts the ramp colder or hotter, and the position around the
 * spectrum tints it. `light` sets the brightness; `white` (1 while
 * developing) burns it to white.
 */
function tubeColor(temperature: number, depth: number, pos: number, tint: number, light: number, white: number): string {
  const hue = 320 - 135 * depth + (temperature - 0.5) * 110 + (pos - 0.5) * 36 + tint
  let l = 4 + 54 * light
  l += (97 - l) * white
  const lightness = Math.min(97, Math.max(2, l))
  const sat = 100 - 80 * white
  return `hsl(${(((hue % 360) + 360) % 360).toFixed(0)}, ${sat.toFixed(0)}%, ${lightness.toFixed(0)}%)`
}

/**
 * Tunnel of glowing tubes, following the reference's behaviour:
 *
 * 1. A tube is born at the innermost position, glowing white.
 * 2. While white, it develops its shape from the sound of that moment; the
 *    shape grows vertically (straight up), not outward.
 * 3. After 1/15 s it is done: it takes its colour, moves to the next
 *    position out, and a new white tube is born inside it.
 * 4. The white tube is the scene's light. Its brightness follows the music,
 *    so when the music stops it goes dark and so does everything.
 *
 * Tubes are drawn as shaded cylinders (dark edge, lit body, highlight on
 * the side facing the light), far to near, with older tubes stacked above
 * newer ones so walls become vertical curtains of tubes.
 */
export class FiberTunnel {
  private readonly tubes: Tube[]
  private head = -1
  private count = 0
  private time = 0
  /** Brightness of the white tube = the scene's light, 0..1. */
  private light = 0
  /** Slow left/right camera roll; this frame's angle in radians. */
  private readonly roll = new RollCamera()
  private rollAngle = 0
  /** Spectrum smoothed over time; tubes develop from this, not the raw frame. */
  private readonly smoothBands: Float32Array
  /** Scratch: raw per-band peak strength before spreading. */
  private readonly rawPeaks: Float32Array
  private readonly pos: Float32Array
  /** Wall height factor per point: full over the top and sides, none on the floor. */
  private readonly wallWeight: Float32Array
  private readonly cos: Float32Array
  private readonly sin: Float32Array
  // This frame's geometry by live index: screen points, world points (for lighting), loudness.
  private readonly xs = new Float32Array(MAX_TUBES * POINTS)
  private readonly ys = new Float32Array(MAX_TUBES * POINTS)
  private readonly wx = new Float32Array(MAX_TUBES * POINTS)
  private readonly wy = new Float32Array(MAX_TUBES * POINTS)
  /** Scratch: one tube's points shifted toward the light, for its highlight. */
  private readonly hlX = new Float32Array(POINTS)
  private readonly hlY = new Float32Array(POINTS)
  private readonly layer: HTMLCanvasElement
  private readonly trail: HTMLCanvasElement
  private readonly bloom: HTMLCanvasElement
  private layerCtx: CanvasRenderingContext2D | null = null
  private trailCtx: CanvasRenderingContext2D | null = null
  private bloomCtx: CanvasRenderingContext2D | null = null

  constructor(bandCount: number) {
    this.tubes = Array.from({ length: MAX_TUBES }, () => ({
      bands: new Float32Array(bandCount),
      peaks: new Float32Array(bandCount),
      level: 0,
      onset: 0,
      temperature: 0.5,
      z: Z_FAR,
      age: 0,
      jitter: 0,
      turn: 0,
      wave: 0,
    }))
    this.smoothBands = new Float32Array(bandCount)
    this.rawPeaks = new Float32Array(bandCount)
    this.pos = new Float32Array(POINTS)
    this.wallWeight = new Float32Array(POINTS)
    this.cos = new Float32Array(POINTS)
    this.sin = new Float32Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      const th = (i / POINTS) * 2 * Math.PI
      this.cos[i] = Math.cos(th)
      this.sin[i] = Math.sin(th)
      // Canvas y points down, so θ = 3π/2 is the top. Bass (usually the loudest)
      // goes there, raising walls over the top; quieter treble lines the floor.
      const fromTop = Math.abs(((th - 1.5 * Math.PI + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
      this.pos[i] = fromTop / Math.PI
      // −sin θ is 1 at the top, 0 at the sides, −1 at the bottom.
      this.wallWeight[i] = smooth(-0.6, 0.3, -this.sin[i])
    }
    this.layer = document.createElement('canvas')
    this.trail = document.createElement('canvas')
    this.bloom = document.createElement('canvas')
  }

  reset() {
    this.count = 0
    this.trailCtx?.clearRect(0, 0, this.trail.width, this.trail.height)
  }

  /** i-th live tube, oldest (nearest the camera) first; the last one is the white tube. */
  private tube(i: number): Tube {
    return this.tubes[(this.head - this.count + 1 + i + MAX_TUBES * 2) % MAX_TUBES]
  }

  /**
   * Advances by dt. While `playing`, a new white tube is born every 1/15 s and
   * the previous one leaves the centre. `lifetime` is the travel time from
   * the hollow to the camera.
   */
  update(dt: number, input: FiberInput, playing: boolean, onset: number, lifetime: number) {
    this.time += dt
    this.rollAngle = this.roll.update(dt)
    // The scene light is the white tube's brightness, which follows the music.
    const target = playing ? input.level : 0
    this.light += (target - this.light) * (1 - Math.exp(-dt / LIGHT_RESPONSE))

    const a = 1 - Math.exp(-dt / COHERENCE)
    const sb = this.smoothBands
    for (let i = 0; i < sb.length; i++) sb[i] += (input.bands[i] - sb[i]) * a

    // Finished tubes travel outward in log-depth (even spacing on screen);
    // the developing white tube stays at the centre.
    const k = Math.log(Z_FAR / Z_NEAR) / lifetime
    const shrink = Math.exp(-k * dt)
    const develop = 1 / TUBE_RATE
    for (let i = 0; i < this.count; i++) {
      const t = this.tube(i)
      t.age += dt
      if (i < this.count - 1 || t.age > develop) t.z *= shrink
    }
    while (this.count > 0 && this.tube(0).z <= Z_NEAR) this.count--

    if (!playing) return
    const headTube = this.count > 0 ? this.tube(this.count - 1) : null
    if (!headTube || headTube.age >= develop) this.birth(input)
    // The white tube keeps developing: it holds the loudest moment of its window.
    this.develop(this.tube(this.count - 1), input, onset)
  }

  private birth(input: FiberInput) {
    if (this.count === MAX_TUBES) this.count--
    this.head = (this.head + 1) % MAX_TUBES
    this.count++
    const t = this.tubes[this.head]
    t.bands.fill(0)
    t.level = 0
    t.onset = 0
    t.temperature = input.temperature
    t.z = Z_FAR
    t.age = 0
    t.jitter = ((this.head * 0.618034) % 1) - 0.5
    t.turn = 0.45 * Math.sin(this.time * 0.07) + 0.15 * Math.sin(this.time * 0.19 + 1)
    t.wave = this.time * 0.9
  }

  private develop(t: Tube, input: FiberInput, onset: number) {
    const n = t.bands.length
    const sb = this.smoothBands
    // Light blur across bands keeps the shape organic; keep the peak of the window.
    for (let i = 0; i < n; i++) {
      const v = 0.25 * sb[Math.max(0, i - 1)] + 0.5 * sb[i] + 0.25 * sb[Math.min(n - 1, i + 1)]
      if (v > t.bands[i]) t.bands[i] = v
    }
    t.level = Math.max(t.level, input.level)
    t.onset = Math.max(t.onset, onset)
    t.temperature = input.temperature
    // Walls rise at spectral peaks only: bands clearly louder than their
    // neighbours, and loud in absolute terms. Spread with a bell so walls are
    // rounded curtains, not spikes.
    for (let i = 0; i < n; i++) {
      let sum = 0
      let cnt = 0
      for (let j = Math.max(0, i - WALL_SPAN); j <= Math.min(n - 1, i + WALL_SPAN); j++) {
        sum += t.bands[j]
        cnt++
      }
      const contrast = t.bands[i] - sum / cnt - WALL_MIN_CONTRAST
      this.rawPeaks[i] = Math.min(1, Math.max(0, contrast / WALL_CONTRAST)) * smooth(0.25, 0.6, t.bands[i])
    }
    const half = WALL_SPREAD.length >> 1
    const top = WALL_SPREAD[half]
    for (let i = 0; i < n; i++) {
      let m = 0
      for (let q = -half; q <= half; q++) {
        const j = i + q
        if (j >= 0 && j < n) m = Math.max(m, this.rawPeaks[j] * (WALL_SPREAD[q + half] / top))
      }
      t.peaks[i] = m
    }
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

  /**
   * Lighting at point p of live tube i from the white tube's light, treating
   * the tubes as samples of a surface: the normal comes from the tangent
   * along the tube and the step to the neighbouring tube `nb`.
   */
  private shade(i: number, nb: number, p: number): number {
    const P = POINTS
    const o = i * P
    const p0 = (p - 1 + P) % P
    const p1 = (p + 1) % P
    const zi = this.tube(i).z
    const ax = this.wx[o + p1] - this.wx[o + p0]
    const ay = this.wy[o + p1] - this.wy[o + p0]
    const az = 0
    const bx = this.wx[nb * P + p] - this.wx[o + p]
    const by = this.wy[nb * P + p] - this.wy[o + p]
    const bz = this.tube(nb).z - zi
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    const px = this.wx[o + p]
    const py = this.wy[o + p]
    // Face the inside of the tunnel (toward its axis).
    if (nx * px + ny * py > 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    // The light: the white tube at the far end of the tunnel.
    let lx = -px
    let ly = -py
    let lz = Z_FAR - zi
    const dist = Math.hypot(lx, ly, lz) || 1
    lx /= dist
    ly /= dist
    lz /= dist
    const atten = 1 / (1 + (dist / LIGHT_FALLOFF) ** 2)
    const diffuse = 0.35 + 0.65 * Math.max(0, nx * lx + ny * ly + nz * lz)
    return AMBIENT + this.light * 1.9 * diffuse * atten
  }

  /** Draws the tube layer onto `ctx`, over whatever background is already there. */
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
    // Focal length: a plain tube at Z_NEAR just overfills the screen.
    const focal = reach * 1.15 * Z_NEAR

    lc.setTransform(1, 0, 0, 1, 0, 0)
    lc.globalCompositeOperation = 'source-over'
    lc.globalAlpha = 1
    lc.clearRect(0, 0, W, H)

    // A faint trail: last frame, pushed outward a touch.
    lc.save()
    lc.translate(cx, cy)
    lc.scale(1.006, 1.006)
    lc.globalAlpha = 0.1
    lc.drawImage(this.trail, -cx, -cy, W, H)
    lc.restore()

    if (this.count > 0) this.drawTubes(lc, cx, cy, focal, H)

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
    ctx.globalAlpha = 0.25 + 0.35 * this.light
    ctx.drawImage(this.bloom, 0, 0, W, H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawTubes(lc: CanvasRenderingContext2D, cx: number, cy: number, focal: number, H: number) {
    const camX = 0.12 * Math.sin(this.time * 0.11)
    const camY = CAMERA_HEIGHT + 0.08 * Math.sin(this.time * 0.08 + 1.3)
    const aimY = AIM * H
    const last = this.tubes[0].bands.length - 1
    const logSpan = Math.log(Z_FAR / Z_NEAR)
    const develop = 1 / TUBE_RATE
    const { xs, ys, wx, wy } = this
    const P = POINTS

    // Geometry. Sound lifts a tube straight up; consecutive tubes develop
    // from similar sound, so their walls layer into vertical curtains.
    for (let i = this.count - 1; i >= 0; i--) {
      const t = this.tube(i)
      const z = t.z
      const s = focal / z
      const growth = smooth(0, develop, t.age)
      const amp = (0.4 + 0.6 * t.level) * (1 + 0.5 * t.onset) * growth
      const shift = Math.round((t.turn / (2 * Math.PI)) * P)
      const ox = cx - camX * s
      const oy = cy + aimY + camY * s
      const o = i * P
      for (let p = 0; p < P; p++) {
        const q = this.pos[(p + shift + P * 4) % P] * last
        const k0 = q | 0
        const f = q - k0
        const lift = t.peaks[k0] * (1 - f) + t.peaks[Math.min(last, k0 + 1)] * f
        const shape = lift * lift * (3 - 2 * lift)
        const r = 1 + 0.004 * t.jitter
        // Many small waves, as tall as the band is loud, plus walls at the peaks.
        const v = t.bands[k0] * (1 - f) + t.bands[Math.min(last, k0 + 1)] * f
        const th = (p / P) * 2 * Math.PI
        const ripple = WAVE_HEIGHT * v * v * (0.5 + 0.5 * Math.sin(WAVE_COUNT * th + t.wave))
        const h = (WALL_HEIGHT * shape + ripple) * amp * this.wallWeight[p]
        const x = ox + r * this.cos[p] * s
        const y = oy + (r * this.sin[p] - h) * s
        xs[o + p] = x
        ys[o + p] = y
        wx[o + p] = r * this.cos[p]
        wy[o + p] = (y - oy) / s
      }
    }

    // Camera roll: tilt the whole tunnel around the screen centre.
    const rc = Math.cos(this.rollAngle)
    const rs = Math.sin(this.rollAngle)
    lc.setTransform(rc, rs, -rs, rc, cx - cx * rc + cy * rs, cy - cx * rs - cy * rc)
    lc.lineJoin = 'round'
    lc.lineCap = 'round'

    // Draw far to near: the white tube first, the nearest tube last, so nearer
    // tubes pass in front of farther ones like real cylinders.
    for (let i = this.count - 1; i >= 0; i--) {
      const t = this.tube(i)
      const z = t.z
      const depth = Math.log(Z_FAR / z) / logSpan
      const fade = 1 - smooth(0.85, 1, depth)
      if (fade < 0.01) continue
      const o = i * P
      const shift = Math.round((t.turn / (2 * Math.PI)) * P)
      const s = focal / z
      const width = Math.max(0.9, 2 * TUBE_RADIUS * s)
      const white = 1 - smooth(develop, develop + COOL_TIME, t.age)
      const tint = t.jitter * 16
      const nb = i + 1 < this.count ? i + 1 : i - 1
      // Highlight side: toward the light, i.e. toward the hollow's centre.
      const hx = cx - camX * (focal / Z_FAR)
      const hy = cy + aimY + camY * (focal / Z_FAR)

      // The white tube is the light: a halo whose strength follows the music.
      if (white > 0.02) {
        lc.globalCompositeOperation = 'lighter'
        lc.globalAlpha = Math.min(1, 0.35 * white * this.light)
        lc.strokeStyle = tubeColor(t.temperature, 0, 0.5, 0, 1, 0.3)
        lc.lineWidth = width * 7
        this.tracePath(lc, xs, ys, o, 0, P)
        lc.stroke()
        lc.globalCompositeOperation = 'source-over'
      }

      // Dark edge of the cylinder, whole tube at once.
      lc.globalAlpha = fade
      lc.strokeStyle = '#000'
      lc.lineWidth = width
      this.tracePath(lc, xs, ys, o, 0, P)
      lc.stroke()

      const highlight = width > 1.6
      if (highlight) {
        const off = width * 0.17
        for (let p = 0; p < P; p++) {
          const dx = hx - xs[o + p]
          const dy = hy - ys[o + p]
          const d = Math.hypot(dx, dy) || 1
          this.hlX[p] = xs[o + p] + (dx / d) * off
          this.hlY[p] = ys[o + p] + (dy / d) * off
        }
      }

      for (let sg = 0; sg < SEGMENTS; sg++) {
        const a = Math.round((sg * P) / SEGMENTS)
        const b = Math.round(((sg + 1) * P) / SEGMENTS)
        const pc = (a + b) >> 1
        const lit = nb >= 0 ? this.shade(i, nb, pc) : AMBIENT + this.light
        // A developing tube glows with the light it emits.
        const light = white > 0 ? lit + (this.light - lit) * white : lit
        const pos = this.pos[(pc + shift + P * 4) % P]
        // Body of the cylinder.
        lc.strokeStyle = tubeColor(t.temperature, depth, pos, tint, light, white * this.light)
        lc.lineWidth = width * 0.66
        this.tracePath(lc, xs, ys, o, a, b)
        lc.stroke()
        // Highlight along the side facing the light.
        if (highlight) {
          lc.strokeStyle = tubeColor(t.temperature, depth, pos, tint, Math.min(1.6, light * 1.6 + 0.08), white * this.light)
          lc.lineWidth = width * 0.22
          this.tracePath(lc, this.hlX, this.hlY, 0, a, b)
          lc.stroke()
        }
      }
    }
    lc.globalAlpha = 1
    lc.globalCompositeOperation = 'source-over'
  }

  /**
   * Traces points a..b (wrapping) of the loop stored at offset o in (X, Y) as
   * a smooth curve: points are control points, the curve passes through the
   * midpoints between them, so consecutive segments join seamlessly.
   */
  private tracePath(lc: CanvasRenderingContext2D, X: Float32Array, Y: Float32Array, o: number, a: number, b: number) {
    const P = POINTS
    const at = (k: number) => o + (((k % P) + P) % P)
    let i0 = at(a - 1)
    let i1 = at(a)
    lc.beginPath()
    lc.moveTo((X[i0] + X[i1]) / 2, (Y[i0] + Y[i1]) / 2)
    for (let k = a; k < b; k++) {
      i0 = at(k)
      i1 = at(k + 1)
      lc.quadraticCurveTo(X[i0], Y[i0], (X[i0] + X[i1]) / 2, (Y[i0] + Y[i1]) / 2)
    }
    if (a === 0 && b === P) lc.closePath()
  }
}
