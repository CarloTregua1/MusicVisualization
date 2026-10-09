import { neon } from './neon'

const MAX_RINGS = 16
const POINTS = 256
/** Kaleidoscope symmetry: the spectrum is mirrored this many times around each ring. */
const FOLDS = 6
/** Colour stops per mirrored half-segment of a ring's conic gradient. */
const STOPS_PER_HALF = 5
/** Filaments linking each string to the next; 2× FOLDS keeps the symmetry. */
const SPOKES = 12
const MAX_PULSES = 200
/** After an onset the newborn string keeps absorbing the attack for this long (s). */
const CAPTURE_WINDOW = 0.12

interface Ring {
  bands: Float32Array
  /** Depth: 0 at birth (at the hollow core), 1 when it leaves the screen. */
  u: number
  level: number
  lobes: number
  temperature: number
  /** Onset strength that created this string, 0..1. */
  beat: number
  /** Birth order, used to keep filaments and pulses attached to this ring as indices shift. */
  serial: number
  /** Mean level of the top bands, drives the fine shimmer on the string. */
  treble: number
  /** Seconds since birth, for the string's vibration. */
  age: number
  angle: number
  // Shading gradients for the tube: dark edge, body, pale highlight.
  dark: CanvasGradient | null
  body: CanvasGradient | null
  pale: CanvasGradient | null
}

interface Pulse {
  spoke: number
  /**
   * Position in ring-serial space: serial s is the ring born s-th, and the
   * hollow core sits at (newest serial + 1). Pulses fall toward older serials,
   * i.e. outward, and stay glued to the strings as they move.
   */
  sigma: number
  energy: number
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
  /** Decaying onset glow 0..1. */
  beat: number
}

/**
 * A neon tunnel of concentric spectral strings, rendered as shaded 3D ropes
 * and joined by a lattice of glowing filaments that carry light pulses
 * outward. A string is born at the hollow centre only when the music has an
 * onset; it absorbs the attack, then travels outward with perspective,
 * vibrating like a plucked string. The innermost string is therefore always
 * the most recent sound event.
 *
 * Strings, filaments and pulses live on their own transparent layer with a
 * short feedback trail, composited over whatever background the caller drew.
 */
export class Tunnel {
  private readonly rings: Ring[]
  private head = 0
  private count = 0
  private angle = 0
  private time = 0
  private beatGlow = 0
  private serial = 0
  /** Slow drift of the filament anchors around the rings. */
  private drift = 0
  private readonly pulses: Pulse[] = Array.from({ length: MAX_PULSES }, () => ({ spoke: 0, sigma: 0, energy: 0 }))
  private pulseCount = 0
  // Per-frame geometry: ring outlines in each ring's local frame (by pool slot)…
  private readonly localX = new Float32Array(MAX_RINGS * POINTS)
  private readonly localY = new Float32Array(MAX_RINGS * POINTS)
  // …and filament anchors in screen space by live index (oldest first), with the core last.
  private readonly nodeX = new Float32Array((MAX_RINGS + 1) * SPOKES)
  private readonly nodeY = new Float32Array((MAX_RINGS + 1) * SPOKES)
  private readonly nodeAlpha = new Float32Array(MAX_RINGS + 1)
  private readonly nodeU = new Float32Array(MAX_RINGS + 1)
  private readonly ctrl = new Float32Array(2)
  private readonly fold: Float32Array
  private readonly cos: Float32Array
  private readonly sin: Float32Array
  /** This frame's string layer, and last frame's (for the trail). */
  private readonly layer: HTMLCanvasElement
  private readonly trail: HTMLCanvasElement
  private layerCtx: CanvasRenderingContext2D | null = null
  private trailCtx: CanvasRenderingContext2D | null = null

  constructor(bandCount: number) {
    this.rings = Array.from({ length: MAX_RINGS }, () => ({
      bands: new Float32Array(bandCount),
      u: 1,
      level: 0,
      lobes: 0,
      temperature: 0.5,
      beat: 0,
      serial: 0,
      treble: 0,
      age: 0,
      angle: 0,
      dark: null,
      body: null,
      pale: null,
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
    this.layer = document.createElement('canvas')
    this.trail = document.createElement('canvas')
  }

  reset() {
    this.count = 0
    this.pulseCount = 0
    this.trailCtx?.clearRect(0, 0, this.trail.width, this.trail.height)
  }

  /**
   * Advances the tunnel by dt seconds. `onset` > 0 (its strength, 0..1)
   * births a new string from `input`; otherwise no string is created.
   * `lifetime` is how long a string takes to reach the edge; `spin` is the
   * rotation rate of newly born strings in rad/s.
   */
  update(dt: number, input: TunnelInput, lifetime: number, spin: number, onset: number) {
    this.time += dt
    this.angle += dt * spin
    this.drift = 0.35 * Math.sin(this.time * 0.11)
    this.beatGlow = Math.max(input.beat, this.beatGlow * Math.exp(-dt * 6))
    const step = dt / lifetime
    for (let i = 0; i < this.count; i++) {
      const r = this.ring(i)
      r.u += step
      r.age += dt
    }
    while (this.count > 0 && this.ring(0).u >= 1) this.count--

    if (onset > 0) this.spawn(input, onset)
    else if (this.count > 0) {
      // A newborn string keeps the loudest moment of its attack.
      const newest = this.rings[this.head]
      if (newest.age < CAPTURE_WINDOW) this.capture(newest, input, true)
    }
    this.updatePulses(dt, input, onset)
  }

  /** i-th live ring, oldest first. */
  private ring(i: number): Ring {
    return this.rings[this.slot(i)]
  }

  private slot(i: number): number {
    return (this.head - this.count + 1 + i + MAX_RINGS * 2) % MAX_RINGS
  }

  private spawn(input: TunnelInput, strength: number) {
    if (this.count === MAX_RINGS) this.count--
    this.head = (this.head + 1) % MAX_RINGS
    this.count++
    const r = this.rings[this.head]
    r.u = 0
    r.age = 0
    r.beat = strength
    r.angle = this.angle
    r.serial = this.serial++
    this.capture(r, input, false)
  }

  private capture(r: Ring, input: TunnelInput, keepPeak: boolean) {
    const b = input.bands
    if (keepPeak) for (let i = 0; i < b.length; i++) r.bands[i] = Math.max(r.bands[i], b[i])
    else r.bands.set(b)
    r.level = keepPeak ? Math.max(r.level, input.level) : input.level
    r.lobes = input.lobes
    r.temperature = input.temperature
    const from = Math.floor(b.length * 0.6)
    let t = 0
    for (let i = from; i < b.length; i++) t += r.bands[i]
    r.treble = t / (b.length - from)
    r.dark = r.body = r.pale = null
  }

  /** Spoke j's anchor angle in a ring's local frame. */
  private spokeAngle(j: number): number {
    return (j / SPOKES) * 2 * Math.PI + this.drift
  }

  private updatePulses(dt: number, input: TunnelInput, onset: number) {
    if (this.count === 0) {
      this.pulseCount = 0
      return
    }
    const oldest = this.ring(0).serial
    const core = this.rings[this.head].serial + 1
    // Strings are sparse now, so pulses cross about two gaps per second, faster after an onset.
    const speed = 1.8 + 3 * this.beatGlow
    let n = 0
    for (let i = 0; i < this.pulseCount; i++) {
      const p = this.pulses[i]
      p.sigma -= dt * speed
      if (p.sigma < oldest) continue
      if (n !== i) {
        const q = this.pulses[n]
        q.spoke = p.spoke
        q.sigma = p.sigma
        q.energy = p.energy
      }
      n++
    }
    this.pulseCount = n

    const bands = input.bands
    for (let j = 0; j < SPOKES; j++) {
      const pos = fold(this.spokeAngle(j))
      const level = bands[Math.round(pos * (bands.length - 1))]
      const rate = 0.15 + 1.6 * level * level
      if ((onset > 0 || Math.random() < rate * dt) && this.pulseCount < MAX_PULSES) {
        const p = this.pulses[this.pulseCount++]
        p.spoke = j
        p.sigma = core
        p.energy = Math.min(1, 0.35 + level + 0.5 * onset)
      }
    }
  }

  /** Conic gradient for a ring: hue from spectrum position, lightness from that band's energy. */
  private gradient(ctx: CanvasRenderingContext2D, r: Ring, lightness: number, spread: number): CanvasGradient {
    const g = ctx.createConicGradient(0, 0, 0)
    const n = FOLDS * 2 * STOPS_PER_HALF
    const bands = r.bands
    for (let j = 0; j <= n; j++) {
      const p = j / n
      const pos = fold(p * 2 * Math.PI)
      const level = bands[Math.min(bands.length - 1, Math.round(pos * (bands.length - 1)))]
      g.addColorStop(p, neon(r.temperature, pos, lightness + spread * level))
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
    this.layerCtx ??= this.layer.getContext('2d')
    this.trailCtx ??= this.trail.getContext('2d')
  }

  /** Draws the strings layer onto `ctx`, over whatever is already there. */
  render(ctx: CanvasRenderingContext2D) {
    const W = ctx.canvas.width
    const H = ctx.canvas.height
    this.ensureLayers(W, H)
    const lc = this.layerCtx
    const tc = this.trailCtx
    if (!lc || !tc) return
    const cx = W / 2
    const cy = H / 2
    const minDim = Math.min(W, H)
    const reach = Math.hypot(W, H) / 2
    const hole = minDim * 0.075
    const px = minDim / 900

    lc.setTransform(1, 0, 0, 1, 0, 0)
    lc.globalCompositeOperation = 'source-over'
    lc.globalAlpha = 1
    lc.clearRect(0, 0, W, H)

    // Short trail: last frame's layer, zoomed outward a touch and faded.
    lc.save()
    lc.translate(cx, cy)
    lc.rotate(0.004 * Math.sin(this.time * 0.37))
    const zoom = 1.012 + 0.015 * this.beatGlow
    lc.scale(zoom, zoom)
    lc.globalAlpha = 0.3
    lc.drawImage(this.trail, -cx, -cy, W, H)
    lc.restore()

    // Keep the core hollow: erase any trail that drifted into it.
    lc.globalCompositeOperation = 'destination-out'
    const core = lc.createRadialGradient(cx, cy, 0, cx, cy, hole * 1.3)
    core.addColorStop(0, 'rgba(0,0,0,1)')
    core.addColorStop(0.65, 'rgba(0,0,0,1)')
    core.addColorStop(1, 'rgba(0,0,0,0)')
    lc.fillStyle = core
    lc.fillRect(cx - hole * 1.3, cy - hole * 1.3, hole * 2.6, hole * 2.6)

    if (this.count > 0) {
      this.computeGeometry(cx, cy, hole, reach)
      lc.lineJoin = 'round'
      lc.lineCap = 'round'
      lc.globalCompositeOperation = 'lighter'
      this.drawFilaments(lc, px)
      this.drawStrings(lc, cx, cy, px)
      lc.globalCompositeOperation = 'lighter'
      this.drawPulses(lc, px)
    }

    tc.globalCompositeOperation = 'copy'
    tc.globalAlpha = 1
    tc.drawImage(this.layer, 0, 0)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.drawImage(this.layer, 0, 0)
  }

  /** Ring outlines (local frames) and filament anchors (screen space) for this frame. */
  private computeGeometry(cx: number, cy: number, hole: number, reach: number) {
    const bandsMax = this.rings[0].bands.length - 1
    const { localX, localY, nodeX, nodeY, nodeAlpha, nodeU } = this
    for (let i = 0; i < this.count; i++) {
      const r = this.ring(i)
      const u = Math.min(r.u, 1)
      const base = hole + (reach * 1.08 - hole) * Math.pow(u, 1.8)
      const shape = 0.16 + 0.2 * u
      // Plucked-string vibration: a standing wave whose mode is the note's
      // lobe count, ringing and decaying with age, plus a faster treble shimmer.
      const pluck = Math.exp(-r.age * 1.1) * (0.35 + r.level + 0.8 * r.beat)
      const swing = 0.06 * pluck * Math.cos(2 * Math.PI * 1.6 * r.age)
      const shimmer = 0.018 * r.treble * Math.exp(-r.age * 0.6)
      const shimmerMode = 2 * r.lobes + 1
      const shimmerPhase = 7 * r.age
      const o = this.slot(i) * POINTS
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
        localX[o + p] = rad * this.cos[p]
        localY[o + p] = rad * this.sin[p]
      }
      const rot = r.angle + u * 0.6
      const c = Math.cos(rot)
      const sn = Math.sin(rot)
      for (let j = 0; j < SPOKES; j++) {
        const a = this.spokeAngle(j)
        const p = ((Math.round((a / (2 * Math.PI)) * POINTS) % POINTS) + POINTS) % POINTS
        const lx = localX[o + p]
        const ly = localY[o + p]
        nodeX[i * SPOKES + j] = cx + lx * c - ly * sn
        nodeY[i * SPOKES + j] = cy + lx * sn + ly * c
      }
      // Fade in quickly at birth, out near the edge.
      nodeAlpha[i] = smooth(0, 0.04, u) * (1 - smooth(0.72, 1, u))
      nodeU[i] = u
    }
    // The core node: on the rim of the hollow (nothing is drawn inside it), in the newest ring's frame.
    const n = this.count
    const newest = this.rings[this.head]
    const rot = newest.angle + Math.min(newest.u, 1) * 0.6
    for (let j = 0; j < SPOKES; j++) {
      const a = this.spokeAngle(j) + rot
      nodeX[n * SPOKES + j] = cx + hole * 0.8 * Math.cos(a)
      nodeY[n * SPOKES + j] = cy + hole * 0.8 * Math.sin(a)
    }
    nodeAlpha[n] = 1
    nodeU[n] = 0
  }

  /** Control point of the filament from node (i, j) to node (i + 1, j): bowed sideways and swaying. */
  private bend(i: number, j: number, out: Float32Array) {
    const ax = this.nodeX[i * SPOKES + j]
    const ay = this.nodeY[i * SPOKES + j]
    const bx = this.nodeX[(i + 1) * SPOKES + j]
    const by = this.nodeY[(i + 1) * SPOKES + j]
    const sway = 0.22 * Math.sin(this.time * 1.3 + j * 0.9 + this.ring(i).serial * 0.7)
    out[0] = (ax + bx) / 2 - (by - ay) * sway
    out[1] = (ay + by) / 2 + (bx - ax) * sway
  }

  private drawFilaments(ctx: CanvasRenderingContext2D, px: number) {
    const ctrl = this.ctrl
    const temp = this.rings[this.head].temperature
    for (let j = 0; j < SPOKES; j++) {
      ctx.strokeStyle = neon(temp, fold(this.spokeAngle(j)), 62)
      // Segment i joins live ring i to the next newer one (or the core).
      for (let i = 0; i < this.count; i++) {
        const alpha = Math.min(this.nodeAlpha[i], this.nodeAlpha[i + 1])
        if (alpha <= 0.01) continue
        this.bend(i, j, ctrl)
        ctx.beginPath()
        ctx.moveTo(this.nodeX[i * SPOKES + j], this.nodeY[i * SPOKES + j])
        ctx.quadraticCurveTo(ctrl[0], ctrl[1], this.nodeX[(i + 1) * SPOKES + j], this.nodeY[(i + 1) * SPOKES + j])
        const u = this.nodeU[i]
        ctx.globalAlpha = 0.09 * alpha * (1 + this.beatGlow)
        ctx.lineWidth = (4 + 5 * u) * px
        ctx.stroke()
        ctx.globalAlpha = 0.4 * alpha * (1 + 0.8 * this.beatGlow)
        ctx.lineWidth = (0.9 + 1.1 * u) * px
        ctx.stroke()
      }
    }
  }

  /**
   * Each string as a 3D rope: a soft neon glow, a drop shadow on the
   * background, then a dark edge, a bright body, twisted strands rolling
   * along it, and a highlight + specular line offset toward a top-left light.
   */
  private drawStrings(ctx: CanvasRenderingContext2D, cx: number, cy: number, px: number) {
    for (let i = 0; i < this.count; i++) {
      const r = this.ring(i)
      const alpha = this.nodeAlpha[i]
      if (alpha <= 0.002) continue
      const u = this.nodeU[i]
      const o = this.slot(i) * POINTS
      const path = new Path2D()
      path.moveTo(this.localX[o], this.localY[o])
      for (let p = 1; p < POINTS; p++) path.lineTo(this.localX[o + p], this.localY[o + p])
      path.closePath()

      r.dark ??= this.gradient(ctx, r, 24, 10)
      r.body ??= this.gradient(ctx, r, 50, 20)
      r.pale ??= this.gradient(ctx, r, 78, 12)
      const width = (6 + 18 * u) * px * (1 + 0.25 * r.beat)
      const rot = r.angle + u * 0.6
      const intensity = Math.min(1, (0.55 + 0.45 * r.level) * (1 + 0.4 * r.beat))
      const frame = (ox: number, oy: number) => {
        ctx.setTransform(1, 0, 0, 1, cx + ox, cy + oy)
        ctx.rotate(rot)
      }

      ctx.setLineDash([])
      ctx.globalCompositeOperation = 'lighter'
      frame(0, 0)
      ctx.strokeStyle = r.body
      ctx.globalAlpha = 0.16 * alpha * intensity
      ctx.lineWidth = width * 2.6
      ctx.stroke(path)

      ctx.globalCompositeOperation = 'source-over'
      frame(width * 0.22, width * 0.32)
      ctx.strokeStyle = 'rgba(0,0,0,1)'
      ctx.globalAlpha = 0.5 * alpha
      ctx.lineWidth = width * 1.15
      ctx.stroke(path)

      frame(0, 0)
      ctx.globalAlpha = alpha
      ctx.strokeStyle = r.dark
      ctx.lineWidth = width
      ctx.stroke(path)
      ctx.strokeStyle = r.body
      ctx.globalAlpha = alpha * intensity
      ctx.lineWidth = width * 0.7
      ctx.stroke(path)

      // Twisted strands, like a lace, rolling slowly along the rope.
      ctx.lineCap = 'butt'
      ctx.setLineDash([width * 0.35, width * 0.55])
      ctx.lineDashOffset = -r.age * width * 1.5
      ctx.strokeStyle = r.dark
      ctx.globalAlpha = 0.45 * alpha
      ctx.lineWidth = width * 0.7
      ctx.stroke(path)
      ctx.setLineDash([])
      ctx.lineCap = 'round'

      frame(-width * 0.13, -width * 0.16)
      ctx.strokeStyle = r.pale
      ctx.globalAlpha = 0.85 * alpha
      ctx.lineWidth = width * 0.28
      ctx.stroke(path)

      frame(-width * 0.17, -width * 0.2)
      ctx.strokeStyle = '#fff'
      ctx.globalAlpha = 0.55 * alpha
      ctx.lineWidth = width * 0.08
      ctx.stroke(path)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  /** Comet-like pulses riding the filaments outward. */
  private drawPulses(ctx: CanvasRenderingContext2D, px: number) {
    const oldest = this.ring(0).serial
    const ctrl = this.ctrl
    const temp = this.rings[this.head].temperature
    const TAIL = 4
    for (let k = 0; k < this.pulseCount; k++) {
      const pulse = this.pulses[k]
      const j = pulse.spoke
      ctx.fillStyle = neon(temp, fold(this.spokeAngle(j)), 74)
      for (let t = 0; t < TAIL; t++) {
        // Tail samples trail behind the head (toward the core, i.e. higher sigma).
        const sigma = pulse.sigma + t * 0.05
        // Live index of the outer node of the segment holding sigma; the core is index count.
        const x = Math.min(sigma - oldest, this.count - 1e-6)
        if (x < 0) continue
        const i = Math.floor(x)
        const f = x - i
        const alpha = Math.min(this.nodeAlpha[i], this.nodeAlpha[i + 1])
        if (alpha <= 0.01) continue
        this.bend(i, j, ctrl)
        const ax = this.nodeX[i * SPOKES + j]
        const ay = this.nodeY[i * SPOKES + j]
        const bx = this.nodeX[(i + 1) * SPOKES + j]
        const by = this.nodeY[(i + 1) * SPOKES + j]
        // Quadratic Bézier from a (outer, f = 0) to b (inner, f = 1).
        const g = 1 - f
        const qx = g * g * ax + 2 * g * f * ctrl[0] + f * f * bx
        const qy = g * g * ay + 2 * g * f * ctrl[1] + f * f * by
        const u = this.nodeU[i] * (1 - f) + this.nodeU[i + 1] * f
        const size = (1.6 + 3.2 * u) * px * (1 - t / TAIL) * (0.6 + 0.6 * pulse.energy)
        const a = alpha * pulse.energy * (1 - t / TAIL)
        ctx.globalAlpha = 0.18 * a
        ctx.beginPath()
        ctx.arc(qx, qy, size * 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = a
        ctx.beginPath()
        ctx.arc(qx, qy, size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}
