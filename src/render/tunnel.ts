import { neon } from './neon'

const MAX_RINGS = 48
const POINTS = 320
/** Kaleidoscope symmetry: the spectrum is mirrored this many times around each ring. */
const FOLDS = 6
/** Colour stops per mirrored half-segment of a ring's conic gradient. */
const STOPS_PER_HALF = 5
/** Filaments linking each string to the next; 2× FOLDS keeps the symmetry. */
const SPOKES = 12
const MAX_PULSES = 320

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

interface Ring {
  bands: Float32Array
  /** Depth: 0 at birth (at the hollow core), 1 when it leaves the screen. */
  u: number
  level: number
  lobes: number
  temperature: number
  beat: number
  /** Birth order, used to keep filaments and pulses attached to this ring as indices shift. */
  serial: number
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
 * A neon tunnel of concentric spectral strings, joined by a lattice of
 * glowing filaments that carry light pulses outward from the core. A string is born at the
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
  private serial = 0
  private spawnInterval = 0.25
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
      serial: 0,
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
    this.pulseCount = 0
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
    this.spawnInterval = spawnInterval
    this.drift = 0.35 * Math.sin(this.time * 0.11)
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
    this.updatePulses(dt, input)
  }

  /** Spoke j's anchor angle in a ring's local frame. */
  private spokeAngle(j: number): number {
    return (j / SPOKES) * 2 * Math.PI + this.drift
  }

  private updatePulses(dt: number, input: TunnelInput) {
    const oldest = this.ring(0).serial
    const core = this.rings[this.head].serial + 1
    // Pulses outrun the strings: ~3 strings per spawn interval, faster on a beat.
    const speed = (3 + 5 * this.beatGlow) / this.spawnInterval
    let n = 0
    for (let i = 0; i < this.pulseCount; i++) {
      const p = this.pulses[i]
      p.sigma -= dt * speed
      if (p.sigma < oldest) continue
      // Compact in place.
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
    const fresh = input.beat >= 1
    for (let j = 0; j < SPOKES; j++) {
      const pos = fold(this.spokeAngle(j))
      const level = bands[Math.round(pos * (bands.length - 1))]
      const rate = 0.25 + 2.4 * level * level
      if ((fresh || Math.random() < rate * dt) && this.pulseCount < MAX_PULSES) {
        const p = this.pulses[this.pulseCount++]
        p.spoke = j
        p.sigma = core
        p.energy = Math.min(1, 0.35 + level + (fresh ? 0.5 : 0))
      }
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
    r.u = u
    r.age = 0
    r.beat = 0
    r.serial = this.serial++
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

    // The hollow core: drawn before the strings so it only swallows old trails.
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, hole * 1.5)
    core.addColorStop(0, 'rgba(0,0,0,1)')
    core.addColorStop(0.6, 'rgba(0,0,0,1)')
    core.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = core
    ctx.fillRect(cx - hole * 1.5, cy - hole * 1.5, hole * 3, hole * 3)

    this.computeGeometry(cx, cy, hole, reach)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    this.drawFilaments(ctx, px)
    this.drawStrings(ctx, cx, cy, px)
    this.drawPulses(ctx, px)

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

  /** Ring outlines (local frames) and filament anchors (screen space) for this frame. */
  private computeGeometry(cx: number, cy: number, hole: number, reach: number) {
    const bandsMax = this.rings[0].bands.length - 1
    const { localX, localY, nodeX, nodeY, nodeAlpha, nodeU } = this
    for (let i = 0; i < this.count; i++) {
      const r = this.ring(i)
      const slot = (this.head - this.count + 1 + i + MAX_RINGS * 2) % MAX_RINGS
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
      const o = slot * POINTS
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
      nodeAlpha[i] = smooth(0, 0.05, u) * (1 - smooth(0.72, 1, u))
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
    const serial = this.ring(i).serial
    const sway = 0.22 * Math.sin(this.time * 1.3 + j * 0.9 + serial * 0.7)
    out[0] = (ax + bx) / 2 - (by - ay) * sway
    out[1] = (ay + by) / 2 + (bx - ax) * sway
  }

  private readonly ctrl = new Float32Array(2)

  private drawFilaments(ctx: CanvasRenderingContext2D, px: number) {
    const ctrl = this.ctrl
    const temp = this.rings[this.head].temperature
    for (let j = 0; j < SPOKES; j++) {
      const color = neon(temp, fold(this.spokeAngle(j)), 62)
      ctx.strokeStyle = color
      // Segment i joins live ring i to the next newer one (or the core).
      for (let i = 0; i < this.count; i++) {
        const alpha = Math.min(this.nodeAlpha[i], this.nodeAlpha[i + 1])
        if (alpha <= 0.01) continue
        this.bend(i, j, ctrl)
        ctx.beginPath()
        ctx.moveTo(this.nodeX[i * SPOKES + j], this.nodeY[i * SPOKES + j])
        ctx.quadraticCurveTo(ctrl[0], ctrl[1], this.nodeX[(i + 1) * SPOKES + j], this.nodeY[(i + 1) * SPOKES + j])
        const u = this.nodeU[i]
        ctx.globalAlpha = 0.07 * alpha * (1 + this.beatGlow)
        ctx.lineWidth = (3 + 4 * u) * px
        ctx.stroke()
        ctx.globalAlpha = 0.32 * alpha * (1 + 0.8 * this.beatGlow)
        ctx.lineWidth = (0.6 + 0.6 * u) * px
        ctx.stroke()
      }
    }
  }

  private drawStrings(ctx: CanvasRenderingContext2D, cx: number, cy: number, px: number) {
    for (let i = 0; i < this.count; i++) {
      const r = this.ring(i)
      const alpha = this.nodeAlpha[i]
      if (alpha <= 0.002) continue
      const u = this.nodeU[i]
      const slot = (this.head - this.count + 1 + i + MAX_RINGS * 2) % MAX_RINGS
      const o = slot * POINTS
      const intensity = (0.45 + 0.55 * r.level) * (1 + 0.6 * r.beat)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(r.angle + u * 0.6)
      ctx.beginPath()
      ctx.moveTo(this.localX[o], this.localY[o])
      for (let p = 1; p < POINTS; p++) ctx.lineTo(this.localX[o + p], this.localY[o + p])
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
  }

  /** Comet-like pulses riding the filaments outward. */
  private drawPulses(ctx: CanvasRenderingContext2D, px: number) {
    if (this.count === 0) return
    const oldest = this.ring(0).serial
    const ctrl = this.ctrl
    const temp = this.rings[this.head].temperature
    const TAIL = 4
    for (let k = 0; k < this.pulseCount; k++) {
      const pulse = this.pulses[k]
      const j = pulse.spoke
      const color = neon(temp, fold(this.spokeAngle(j)), 72)
      for (let t = 0; t < TAIL; t++) {
        // Tail samples trail behind the head (toward the core, i.e. higher sigma).
        const sigma = pulse.sigma + t * 0.07
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
        const size = (1.3 + 2.6 * u) * px * (1 - t / TAIL) * (0.6 + 0.6 * pulse.energy)
        const a = alpha * pulse.energy * (1 - t / TAIL)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.16 * a
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
