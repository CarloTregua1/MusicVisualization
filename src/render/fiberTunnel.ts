import { RollCamera } from './camera'
import { tubeColor } from './tubeColor'
import { MEASURED_PARAMS, type TunnelParams } from './tunnelParams'

/** Upper bound on tubes alive at once (40/s × 16 s at the slider limits). */
const MAX_TUBES = 640
const POINTS = 160
/** Each tube is drawn in this many arcs, depth-sorted and lit separately. */
const SEGMENTS = 6
/** Ring radii on the ground: tubes develop at the crater rim and grow until R_MAX. */
const R_RIM = 1
const R_MAX = 6
/** The camera looks at this height above the crater's centre. */
const TARGET_HEIGHT = 0.4
/** Walls rise only where a band beats the mean of its ±WALL_SPAN neighbours (a spectral peak). */
const WALL_SPAN = 3
/** A band must beat its neighbours by this much before any wall rises… */
const WALL_MIN_CONTRAST = 0.02
/** …and by this much (beyond the minimum) for a full-height wall. */
const WALL_CONTRAST = 0.12
/** Weights used to spread each peak over its neighbours. */
const WALL_SPREAD = [1, 4, 1]
/** The light: the white rim, modelled as a point this high above the crater's centre. */
const LIGHT_HEIGHT = 0.6
/** How quickly the scene light follows the music (s): silence goes dark almost at once. */
const LIGHT_RESPONSE = 0.08
/** Light that remains when the white tube is dark: practically none. */
const AMBIENT = 0.05
/** In follow-the-song mode, how long a new tube takes to rise into its shape (s). */
const SONG_GROW_TIME = 0.06
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
  /** Ring radius on the ground. */
  radius: number
  /** Seconds since birth. Development lasts 1/tubesPerSecond s; then the tube cools and grows. */
  age: number
  /** Small per-tube variation so neighbouring tubes don't coincide exactly. */
  jitter: number
  /** Rotation of the spectrum layout: successive tubes turn slowly, so the rings swirl. */
  turn: number
  /** Birth time: sets the phases of its waves and lumps, which drift slowly from
   * tube to tube so neighbours stay coherent while the pattern never repeats. */
  born: number
  // Sound character during development, each driving its own change of shape.
  /** Low/mid/high band energy, 0..1. */
  bass: number
  mid: number
  treble: number
  /** Spectral centroid 0..1 (where the energy sits: low = dull, high = bright). */
  brightness: number
  /** Spectral flatness 0..1 (tonal → noisy). */
  noise: number
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
 * A volcano of glowing tubes on flat land, following the reference:
 *
 * 1. A tube is born as the crater's rim, glowing white.
 * 2. While white, it develops its shape from the sound of that moment: waves
 *    and walls rise straight up from the ground, all around the ring.
 * 3. After 1/tubesPerSecond s it is done: it takes its colour and spreads outward across
 *    the land as an ever larger ring, while a new white tube forms the rim.
 * 4. The white rim is the scene's light. Its brightness follows the music,
 *    so when the music stops it goes dark and so does everything.
 *
 * With params.inward the motion runs the other way: tubes are born and
 * develop at the edge of the land, travel in, become the white innermost
 * tube (and the light) when they reach the crater, and vanish into it as
 * the next one arrives.
 *
 * The camera stands on the land, a little above it, looking at the crater.
 * Tubes are drawn as shaded cylinders (dark edge, lit body, highlight toward
 * the light), with every piece sorted far to near so nearer tubes pass in
 * front of farther ones.
 */
export class FiberTunnel {
  private readonly tubes: Tube[]
  private head = -1
  private count = 0
  private time = 0
  /** Live-tunable look; see tunnelParams.ts. */
  params: TunnelParams = { ...MEASURED_PARAMS }
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
  private readonly cos: Float32Array
  private readonly sin: Float32Array
  // This frame's geometry by live index: screen points, depth, and world points (for lighting).
  private readonly xs = new Float32Array(MAX_TUBES * POINTS)
  private readonly ys = new Float32Array(MAX_TUBES * POINTS)
  private readonly zs = new Float32Array(MAX_TUBES * POINTS)
  private readonly wx = new Float32Array(MAX_TUBES * POINTS)
  private readonly wy = new Float32Array(MAX_TUBES * POINTS)
  private readonly wz = new Float32Array(MAX_TUBES * POINTS)
  /** Segment draw list for depth sorting: tube index × SEGMENTS + segment, and its depth. */
  private readonly order = new Int32Array(MAX_TUBES * SEGMENTS)
  private readonly orderDepth = new Float32Array(MAX_TUBES * SEGMENTS)
  /** Scratch: unit screen direction from each point of a segment toward the light… */
  private readonly toLightX = new Float32Array(POINTS)
  private readonly toLightY = new Float32Array(POINTS)
  /** …and the segment's points shifted along it, for the lit core and glint. */
  private readonly hlX = new Float32Array(POINTS)
  private readonly hlY = new Float32Array(POINTS)
  // Lighting terms from the last shade() call.
  private shadeSpec = 0
  private shadeEdge = 0
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
      radius: R_RIM,
      age: 0,
      jitter: 0,
      turn: 0,
      born: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      brightness: 0,
      noise: 0,
    }))
    this.smoothBands = new Float32Array(bandCount)
    this.rawPeaks = new Float32Array(bandCount)
    this.pos = new Float32Array(POINTS)
    this.cos = new Float32Array(POINTS)
    this.sin = new Float32Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      const th = (i / POINTS) * 2 * Math.PI
      this.cos[i] = Math.cos(th)
      this.sin[i] = Math.sin(th)
      // On the ground, θ = π/2 is the far side of the crater (away from the
      // camera). Bass, usually the loudest, goes there, so the tallest walls
      // rise behind the crater; the layout is mirrored left/right.
      const fromFar = Math.abs(((th - 0.5 * Math.PI + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
      this.pos[i] = fromFar / Math.PI
    }
    this.layer = document.createElement('canvas')
    this.trail = document.createElement('canvas')
    this.bloom = document.createElement('canvas')
  }

  reset() {
    this.count = 0
    this.trailCtx?.clearRect(0, 0, this.trail.width, this.trail.height)
  }

  /** i-th live tube, oldest (outermost) first; the last one is the white rim. */
  private tube(i: number): Tube {
    return this.tubes[(this.head - this.count + 1 + i + MAX_TUBES * 2) % MAX_TUBES]
  }

  /**
   * Advances by dt. While `playing`, a new white tube is born — every
   * 1/tubesPerSecond s, or in follow-the-song mode whenever `songEvent` is
   * true — and the previous one starts spreading outward. `lifetime` is the
   * time a ring takes to grow from the rim to the edge of the land.
   */
  update(dt: number, input: FiberInput, playing: boolean, onset: number, lifetime: number, songEvent = false) {
    this.time += dt
    this.rollAngle = this.roll.update(dt)
    // The scene light is the white tube's brightness, which follows the music.
    const target = playing ? input.level : 0
    this.light += (target - this.light) * (1 - Math.exp(-dt / LIGHT_RESPONSE))

    const a = 1 - Math.exp(-dt / this.params.coherence)
    const sb = this.smoothBands
    for (let i = 0; i < sb.length; i++) sb[i] += (input.bands[i] - sb[i]) * a

    // Finished rings grow exponentially (even spacing in perspective); the
    // developing white rim stays at the crater.
    const k = Math.log(R_MAX / R_RIM) / lifetime
    const inward = this.params.inward
    // Outward, rings grow from the rim; inward, they shrink toward it.
    const grow = Math.exp((inward ? -k : k) * dt)
    const followSong = this.params.followSong
    const develop = 1 / this.params.tubesPerSecond
    for (let i = 0; i < this.count; i++) {
      const t = this.tube(i)
      t.age += dt
      // The rim stays put while it develops; in song mode, until the next event.
      if (i < this.count - 1 || (!followSong && t.age > develop)) t.radius *= grow
    }
    // Remove the oldest tube once it leaves: past the edge outward, or into the
    // crater inward, where the next tube takes over as the white rim at once.
    while (this.count > 0 && (inward ? this.tube(0).radius <= R_RIM : this.tube(0).radius >= R_MAX)) this.count--

    if (!playing) return
    const rim = this.count > 0 ? this.tube(this.count - 1) : null
    if (!rim || (followSong ? songEvent : rim.age >= develop)) this.birth(input)
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
    t.radius = this.params.inward ? R_MAX : R_RIM
    t.age = 0
    t.jitter = ((this.head * 0.618034) % 1) - 0.5
    t.turn = 0.45 * Math.sin(this.time * 0.07) + 0.15 * Math.sin(this.time * 0.19 + 1)
    t.born = this.time
    t.bass = t.mid = t.treble = t.brightness = t.noise = 0
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
    // Sound character: band energies (peak-held over the development window),
    // brightness and noisiness (latest), each shaping the tube differently.
    const third = Math.floor(n / 3)
    let lo = 0
    let mi = 0
    let hi = 0
    let sum = 0
    let weighted = 0
    let logSum = 0
    for (let i = 0; i < n; i++) {
      const v = t.bands[i]
      if (i < third) lo += v
      else if (i < 2 * third) mi += v
      else hi += v
      sum += v
      weighted += v * i
      logSum += Math.log(v + 1e-3)
    }
    t.bass = Math.max(t.bass, lo / third)
    t.mid = Math.max(t.mid, mi / third)
    t.treble = Math.max(t.treble, hi / (n - 2 * third))
    const mean = sum / n
    t.brightness = sum > 1e-6 ? weighted / sum / (n - 1) : 0
    t.noise = mean > 1e-3 ? Math.min(1, Math.exp(logSum / n) / (mean + 1e-3)) : 0
    // Walls rise at spectral peaks only: bands clearly louder than their
    // neighbours, and loud in absolute terms.
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

  /** Draws the tube layer onto `ctx`, over whatever background is already there. */
  render(ctx: CanvasRenderingContext2D) {
    const W = ctx.canvas.width
    const H = ctx.canvas.height
    this.ensureLayers(W, H)
    const lc = this.layerCtx
    const tc = this.trailCtx
    const bc = this.bloomCtx
    if (!lc || !tc || !bc) return

    lc.setTransform(1, 0, 0, 1, 0, 0)
    lc.globalCompositeOperation = 'source-over'
    lc.globalAlpha = 1
    lc.clearRect(0, 0, W, H)
    // A faint trail of the last frame.
    lc.globalAlpha = this.params.trail
    lc.drawImage(this.trail, 0, 0)
    lc.globalAlpha = 1

    if (this.count > 0) this.drawScene(lc, W, H)

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
    ctx.globalAlpha = this.params.bloom * (0.42 + 0.58 * this.light)
    ctx.drawImage(this.bloom, 0, 0, W, H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawScene(lc: CanvasRenderingContext2D, W: number, H: number) {
    const cx = W / 2
    const cy = H / 2
    const pr = this.params
    const focal = pr.focal * Math.min(W, H)
    const camAngle = (pr.cameraAngle * Math.PI) / 180
    const camHeight = pr.cameraRange * Math.sin(camAngle)
    const camDistance = pr.cameraRange * Math.cos(camAngle)
    const P = POINTS
    const last = this.tubes[0].bands.length - 1
    const logSpan = Math.log(R_MAX / R_RIM)
    const develop = 1 / this.params.tubesPerSecond
    const { xs, ys, zs, wx, wy, wz } = this

    // Camera on the land, swaying gently, looking at the crater.
    const camX = 0.25 * Math.sin(this.time * 0.11)
    const camY = camHeight + 0.1 * Math.sin(this.time * 0.08 + 1.3)
    const camZ = -camDistance
    let fx = -camX
    let fy = TARGET_HEIGHT - camY
    let fz = -camZ
    const fl = Math.hypot(fx, fy, fz)
    fx /= fl
    fy /= fl
    fz /= fl
    // right = up × forward, up' = forward × right
    let rx = fz
    let rz = -fx
    const rl = Math.hypot(rx, rz) || 1
    rx /= rl
    rz /= rl
    const ux = fy * rz
    const uy = fz * rx - fx * rz
    const uz = -fy * rx
    const project = (x: number, y: number, z: number, k: number) => {
      const dx = x - camX
      const dy = y - camY
      const dz = z - camZ
      const zc = Math.max(0.25, dx * fx + dy * fy + dz * fz)
      xs[k] = cx + (focal * (dx * rx + dz * rz)) / zc
      ys[k] = cy - (focal * (dx * ux + dy * uy + dz * uz)) / zc
      zs[k] = zc
    }

    // Geometry: each ring lies on the ground around the crater; sound lifts
    // it straight up into sharp waves and walls, all the way around.
    for (let i = 0; i < this.count; i++) {
      const t = this.tube(i)
      const R = t.radius
      const growth = smooth(0, this.params.followSong ? SONG_GROW_TIME : develop, t.age)
      const amp = (0.4 + 0.6 * t.level) * (1 + 0.5 * t.onset) * growth
      const shift = Math.round((t.turn / (2 * Math.PI)) * P)
      const b = t.born
      // Bass: bigger lumps, a wider (breathing) ring, and a tilt toward the
      // bass/treble balance; brightness: how many waves; mids: wave height;
      // treble × noisiness: fine jagged spikes.
      const lumpAmp = pr.lump * (0.4 + 0.6 * t.level + 1.2 * t.bass) * growth
      const breath = 1 + pr.breath * (t.bass - 0.3) * growth
      const tilt = pr.tilt * (t.bass - t.treble) * growth
      const tiltDir = b * 0.23
      const waveFreq = pr.wavesMin + (pr.wavesMax - pr.wavesMin) * t.brightness
      const waveAmp = 0.5 + 1.2 * t.mid
      const jag = pr.jag * t.treble * (0.3 + t.noise) * growth
      // Heights scale with the ring, so a tube keeps its shape as it spreads.
      const hScale = pr.heightUnit * Math.pow(R / R_RIM, 0.85)
      const o = i * P
      for (let p = 0; p < P; p++) {
        const q = this.pos[(p + shift + P * 4) % P] * last
        const k0 = q | 0
        const f = q - k0
        const lift = t.peaks[k0] * (1 - f) + t.peaks[Math.min(last, k0 + 1)] * f
        // Sharp profile: walls rise to narrow, pointed crests.
        const shape = Math.pow(lift, Math.max(1, pr.crestSharpness - 0.8))
        const th = (p / P) * 2 * Math.PI
        // Irregular outline: a few low lumps of unrelated sizes, drifting slowly.
        const lumps =
          0.5 * Math.sin(2 * th + b * 0.31) + 0.3 * Math.sin(3 * th - b * 0.47 + 1.7) + 0.2 * Math.sin(5 * th + b * 0.73 + 4.1)
        const rr = R * breath * (1 + 0.004 * t.jitter + lumpAmp * lumps)
        // Irregular small waves: their count follows the brightness, their
        // height the band's loudness and the mids. They run along the mirrored
        // spectrum position u, so a non-integer count still closes seamlessly.
        // Raising them to a power keeps troughs flat and crests narrow and steep.
        const v = t.bands[k0] * (1 - f) + t.bands[Math.min(last, k0 + 1)] * f
        const u = this.pos[(p + shift + P * 4) % P] * Math.PI
        const waves =
          0.5 * Math.sin(waveFreq * u + b * 0.9) +
          0.3 * Math.sin(waveFreq * 1.7 * u - b * 1.3 + 2.3) +
          0.2 * Math.sin(waveFreq * 2.9 * u + b * 2.1 + 0.6)
        const ripple = pr.waveHeight * waveAmp * v * v * Math.pow(0.5 + 0.5 * waves, pr.crestSharpness)
        // Fine jagged spikes from noisy treble.
        const spikes = jag * Math.pow(0.5 + 0.5 * Math.sin(31 * u + b * 3.7), 6)
        const h = (pr.wallHeight * shape + ripple + spikes) * amp * hScale + tilt * hScale * Math.cos(th - tiltDir)
        // Walls curl outward as they rise, like the reference's towers.
        const X = (rr + pr.curl * h) * this.cos[p]
        const Z = (rr + pr.curl * h) * this.sin[p]
        wx[o + p] = X
        wy[o + p] = h
        wz[o + p] = Z
        project(X, h, Z, o + p)
      }
    }

    // Where the light (the white rim, centred over the crater) lands on screen,
    // so each tube's highlight can sit on the side facing it.
    let lightSX: number
    let lightSY: number
    {
      const dx = -camX
      const dy = LIGHT_HEIGHT - camY
      const dz = -camZ
      const zc = Math.max(0.25, dx * fx + dy * fy + dz * fz)
      lightSX = cx + (focal * (dx * rx + dz * rz)) / zc
      lightSY = cy - (focal * (dx * ux + dy * uy + dz * uz)) / zc
    }

    // Depth-sort every segment of every tube, far to near.
    let n = 0
    for (let i = 0; i < this.count; i++) {
      for (let sg = 0; sg < SEGMENTS; sg++) {
        const pc = (Math.round((sg * P) / SEGMENTS) + Math.round(((sg + 1) * P) / SEGMENTS)) >> 1
        this.order[n] = i * SEGMENTS + sg
        this.orderDepth[n] = zs[i * P + pc]
        n++
      }
    }
    const depthOrder = Array.from({ length: n }, (_, k) => k)
    depthOrder.sort((a, b2) => this.orderDepth[b2] - this.orderDepth[a])

    // Camera roll: tilt the whole view around the screen centre.
    const rc = Math.cos(this.rollAngle)
    const rs = Math.sin(this.rollAngle)
    lc.setTransform(rc, rs, -rs, rc, cx - cx * rc + cy * rs, cy - cx * rs - cy * rc)
    lc.lineJoin = 'round'

    // The white rim is the light: a halo whose strength follows the music.
    // The innermost tube: the newest when moving outward, the oldest when moving inward.
    const whiteIndex = pr.inward ? 0 : this.count - 1
    const rimTube = this.tube(whiteIndex)
    if (this.light > 0.01) {
      const o = whiteIndex * P
      lc.globalCompositeOperation = 'lighter'
      lc.lineCap = 'round'
      lc.globalAlpha = Math.min(1, 0.35 * this.light)
      lc.strokeStyle = tubeColor(rimTube.temperature, 0, 0.5, 0, 1, 0.3)
      lc.lineWidth = Math.max(2, (2 * pr.tubeRadius * focal) / zs[o]) * 3.5
      this.tracePath(lc, xs, ys, o, 0, P)
      lc.stroke()
      lc.globalCompositeOperation = 'source-over'
    }

    lc.lineCap = 'butt'
    for (const k of depthOrder) {
      const item = this.order[k]
      const i = (item / SEGMENTS) | 0
      const sg = item % SEGMENTS
      const t = this.tube(i)
      const R = t.radius
      const depth = Math.log(R / R_RIM) / logSpan
      // Fade near the edge of the land, and before a ring reaches the camera.
      const fade = (1 - smooth(0.85, 1, depth)) * (1 - smooth(0.7, 0.95, R / camDistance))
      if (fade < 0.01) continue
      const o = i * P
      const a = Math.round((sg * P) / SEGMENTS)
      const b = Math.round(((sg + 1) * P) / SEGMENTS)
      const pc = (a + b) >> 1
      const shift = Math.round((t.turn / (2 * Math.PI)) * P)
      // Only the innermost tube is ever white; every other tube keeps its colour
      // (tubeColor caps their lightness so none can look white).
      const white = i === whiteIndex ? 1 : 0
      const tint = t.jitter * 16
      const width = Math.max(0.9, (2 * pr.tubeRadius * Math.pow(R / R_RIM, pr.thicknessGrowth) * focal) / zs[o + pc])
      const nb = i > 0 ? i - 1 : i + 1 < this.count ? i + 1 : -1
      let lit = AMBIENT + this.light
      this.shadeSpec = this.shadeEdge = 0
      if (nb >= 0) lit = this.shade(i, nb, pc, camX, camY, camZ)
      // A developing tube glows with the light it emits.
      const light = white > 0 ? lit + (this.light - lit) * white : lit
      const pos = this.pos[(pc + shift + P * 4) % P]

      const rimWhite = white * this.light
      const colour = (l: number) => tubeColor(t.temperature, depth, pos, tint, l, rimWhite)
      this.tracePath(lc, xs, ys, o, a, b)

      // Contact shadow: a soft dark band that darkens whatever lies behind.
      // Thin, distant tubes can't show shadows, glints or edge glow: skip them there.
      const detailed = width > 2.2
      if (pr.shadow > 0 && detailed) {
        lc.globalAlpha = fade * pr.shadow
        lc.strokeStyle = '#000'
        lc.lineWidth = width * 1.9
        lc.stroke()
      }
      // Edge glow: tube edges seen against the light catch it.
      const edge = this.shadeEdge * pr.edgeGlow
      if (edge > 0.03 && detailed) {
        lc.globalCompositeOperation = 'lighter'
        lc.globalAlpha = Math.min(1, fade * edge)
        lc.strokeStyle = colour(light * 1.2 + 0.2)
        lc.lineWidth = width * 1.3
        lc.stroke()
        lc.globalCompositeOperation = 'source-over'
      }
      // Round cylinder: a dark edge in the tube's own colour, then a mid-tone body…
      lc.globalAlpha = fade
      lc.strokeStyle = colour(light * 0.3)
      lc.lineWidth = width
      lc.stroke()
      lc.strokeStyle = colour(light * 0.75)
      lc.lineWidth = width * 0.74
      lc.stroke()
      if (detailed) {
        // …then a lit core shifted toward the light, and a glint where the
        // surface reflects the rim toward the camera.
        for (let k = a - 1; k <= b + 1; k++) {
          const j = o + (((k % P) + P) % P)
          const m = ((k % P) + P) % P
          const dx = lightSX - xs[j]
          const dy = lightSY - ys[j]
          const d = Math.hypot(dx, dy) || 1
          this.toLightX[m] = dx / d
          this.toLightY[m] = dy / d
        }
        this.shiftTowardLight(o, a, b, width * 0.12)
        lc.strokeStyle = colour(light * 1.05)
        lc.lineWidth = width * 0.4
        this.tracePath(lc, this.hlX, this.hlY, 0, a, b)
        lc.stroke()
        const glint = this.shadeSpec * pr.specular
        if (glint > 0.04) {
          this.shiftTowardLight(o, a, b, width * 0.24)
          lc.strokeStyle = colour(light * 1.1 + glint * 1.5)
          lc.lineWidth = width * 0.14
          this.tracePath(lc, this.hlX, this.hlY, 0, a, b)
          lc.stroke()
        }
      } else {
        lc.strokeStyle = colour(light)
        lc.lineWidth = width * 0.4
        lc.stroke()
      }
    }
    lc.globalAlpha = 1
    lc.globalCompositeOperation = 'source-over'
  }

  /** Fills hlX/hlY with points a..b of the tube at offset o moved `off` px toward the light. */
  private shiftTowardLight(o: number, a: number, b: number, off: number) {
    const P = POINTS
    for (let k = a - 1; k <= b + 1; k++) {
      const m = ((k % P) + P) % P
      this.hlX[m] = this.xs[o + m] + this.toLightX[m] * off
      this.hlY[m] = this.ys[o + m] + this.toLightY[m] * off
    }
  }

  /**
   * Lighting at point p of live tube i, treating the rings as samples of a
   * surface: the normal comes from the tangent along the ring and the step
   * to the neighbouring ring `nb`, turned toward the camera (the visible
   * side). The light is the whole white rim: each point is lit from the
   * nearest point on it. Returns the diffuse + fill brightness, and leaves
   * the glint (specular) and backlit edge (fresnel) terms in shadeSpec /
   * shadeEdge. Everything scales with the music, so silence goes dark.
   */
  private shade(i: number, nb: number, p: number, camX: number, camY: number, camZ: number): number {
    const P = POINTS
    const o = i * P
    const p0 = o + ((p - 1 + P) % P)
    const p1 = o + ((p + 1) % P)
    const ax = this.wx[p1] - this.wx[p0]
    const ay = this.wy[p1] - this.wy[p0]
    const az = this.wz[p1] - this.wz[p0]
    const q = nb * P + p
    const bx = this.wx[q] - this.wx[o + p]
    const by = this.wy[q] - this.wy[o + p]
    const bz = this.wz[q] - this.wz[o + p]
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    const px = this.wx[o + p]
    const py = this.wy[o + p]
    const pz = this.wz[o + p]
    if (nx * (camX - px) + ny * (camY - py) + nz * (camZ - pz) < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    // Nearest point on the white rim (a ring over the crater's edge).
    const phi = Math.atan2(pz, px)
    let lx = R_RIM * Math.cos(phi) - px
    let ly = LIGHT_HEIGHT - py
    let lz = R_RIM * Math.sin(phi) - pz
    const dist = Math.hypot(lx, ly, lz) || 1
    lx /= dist
    ly /= dist
    lz /= dist
    const atten = 1 / (1 + (dist / this.params.lightFalloff) ** 2)
    const ndl = nx * lx + ny * ly + nz * lz
    const diffuse = 0.3 + 0.7 * Math.max(0, ndl)
    // View direction, for the glint, the edge glow and the fill light.
    let vx = camX - px
    let vy = camY - py
    let vz = camZ - pz
    const vl = Math.hypot(vx, vy, vz) || 1
    vx /= vl
    vy /= vl
    vz /= vl
    const ndv = Math.max(0, nx * vx + ny * vy + nz * vz)
    let hx = lx + vx
    let hy = ly + vy
    let hz = lz + vz
    const hl = Math.hypot(hx, hy, hz) || 1
    hx /= hl
    hy /= hl
    hz /= hl
    this.shadeSpec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 32) * atten * 2 * this.light
    // Backlit fresnel: grazing surfaces with the light behind them glow.
    const backlit = Math.max(0, -(vx * lx + vy * ly + vz * lz))
    this.shadeEdge = Math.pow(1 - ndv, 3) * (0.3 + 0.7 * backlit) * atten * 1.6 * this.light
    const fill = this.params.fill * ndv * this.light
    return AMBIENT + this.light * 2.1 * diffuse * atten + fill
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
