import type { BeatPhase } from '../dsp/beats'
import { BEATS_PER_LOOP, DANCE_CLIPS, DANCE_JOINTS, SAMPLES_PER_BEAT } from './danceClips'
import { tubeColor } from './tubeColor'

/** Head radius in figure heights (the figure is about 1 unit tall). */
const HEAD_RADIUS = 0.065
/** A new clip fades in over this many beats. */
const CROSSFADE_BEATS = 1
/** Above this tempo the dancer moves on every other beat (half time), as people do. */
const HALF_TIME_BPM = 130

/** Accent on the beat: rises quickly but smoothly, then eases out over the beat. */
const pulse = (p: number) => Math.sin(Math.PI * Math.min(1, Math.pow(p, 0.6)))
export interface Joint {
  x: number
  y: number
}

export interface Skeleton {
  head: Joint
  neck: Joint
  pelvis: Joint
  shoulderL: Joint
  shoulderR: Joint
  elbowL: Joint
  elbowR: Joint
  handL: Joint
  handR: Joint
  hipL: Joint
  hipR: Joint
  kneeL: Joint
  kneeR: Joint
  footL: Joint
  footR: Joint
}

export interface DancerInput {
  beat: BeatPhase
  /** Loudness 0..1. */
  level: number
  /** Onset strength this frame, 0..1. */
  onset: number
  /** Band energies 0..1 and brightness (spectral centroid) 0..1, for choosing moves and colour. */
  bass: number
  treble: number
  brightness: number
}

export interface DancerStyle {
  /** Amplitude multiplier on the music's energy. */
  energy: number
}

/** Joint positions spring toward the clip with this stiffness (rad/s): smooths clip switches and seeks. */
const POSITION_SPRING = 18
/** Fastest any joint may move, figure heights per second (a quick human hand). */
export const MAX_POINT_SPEED = 3

const JOINT_NAMES = DANCE_JOINTS as readonly (keyof Skeleton)[]
const FRAMES_PER_LOOP = BEATS_PER_LOOP * SAMPLES_PER_BEAT

interface PreparedClip {
  name: string
  frames: number[]
  /** The clip's average pose: where it relaxes to when the music is quiet. */
  rest: Float32Array
  /** Motion energy 0..1 relative to the other clips. */
  energy: number
}

/** Per-clip rest pose and relative motion energy, computed once. */
const CLIPS: PreparedClip[] = (() => {
  const J = JOINT_NAMES.length
  const raw = DANCE_CLIPS.map((c) => {
    const rest = new Float32Array(J * 2)
    for (let f = 0; f < FRAMES_PER_LOOP; f++) for (let k = 0; k < J * 2; k++) rest[k] += c.frames[f * J * 2 + k] / FRAMES_PER_LOOP
    let speed = 0
    for (let f = 1; f < FRAMES_PER_LOOP; f++)
      for (let j = 0; j < J; j++) {
        const a = (f - 1) * J * 2 + j * 2
        const b = f * J * 2 + j * 2
        speed += Math.hypot(c.frames[b] - c.frames[a], c.frames[b + 1] - c.frames[a + 1])
      }
    return { name: c.name, frames: c.frames, rest, speed }
  })
  const lo = Math.min(...raw.map((r) => r.speed))
  const hi = Math.max(...raw.map((r) => r.speed))
  return raw.map((r) => ({ name: r.name, frames: r.frames, rest: r.rest, energy: hi > lo ? (r.speed - lo) / (hi - lo) : 0.5 }))
})()

/** Names of the available dance clips. */
export const DANCE_CLIP_NAMES = CLIPS.map((c) => c.name)

/**
 * A neon dancer for the crater, animated with motion-captured dance loops
 * (see danceClips.ts). Each loop spans 8 beats and is played locked to the
 * song's beat grid: the position in the loop is the beat index plus its
 * phase, so every captured step lands on a beat. Every 8 (dance) beats it
 * picks a clip whose own energy matches the music's, crossfading over a
 * beat. Quiet music relaxes the moves toward the clip's average pose; loud
 * music plays them full out. Joint positions follow through a damped spring
 * with a human speed limit, so seeks and switches never pop.
 */
export class Dancer {
  /** Name of the clip being danced. */
  move = CLIPS[0].name
  private clip = 0
  private prevClip = 0
  /** Dance-beat index at which the current clip started. */
  private moveStart = -Infinity
  private readonly pos = new Float32Array(JOINT_NAMES.length * 2)
  private readonly vel = new Float32Array(JOINT_NAMES.length * 2)
  private readonly target = new Float32Array(JOINT_NAMES.length * 2)
  private started = false
  private energy = 0
  private accent = 0
  /** Colour position (0 bass pink … 1 treble mint), smoothed. */
  colourPos = 0.3
  /** Brightness boost right after each beat, 0..1. */
  flash = 0
  /** Random source for clip choice; replaceable in tests. */
  random: () => number = Math.random

  /** Current joint positions (figure units, y up, ground at 0). */
  skeleton(): Skeleton {
    const sk = {} as Skeleton
    JOINT_NAMES.forEach((name, j) => (sk[name] = { x: this.pos[2 * j], y: this.pos[2 * j + 1] }))
    return sk
  }

  /** Writes clip c's pose at `beats` beats into the loop, relaxed toward its rest pose by (1 − amp). */
  private sample(c: PreparedClip, beats: number, amp: number, out: Float32Array, weight: number) {
    const J2 = JOINT_NAMES.length * 2
    const x = (((beats * SAMPLES_PER_BEAT) % FRAMES_PER_LOOP) + FRAMES_PER_LOOP) % FRAMES_PER_LOOP
    const f0 = Math.floor(x)
    const f1 = (f0 + 1) % FRAMES_PER_LOOP
    const w = x - f0
    for (let k = 0; k < J2; k++) {
      const v = c.frames[f0 * J2 + k] * (1 - w) + c.frames[f1 * J2 + k] * w
      out[k] += (c.rest[k] + (v - c.rest[k]) * amp) * weight
    }
  }

  update(dt: number, input: DancerInput, style: DancerStyle) {
    // Half time for fast music: one dance beat spans two musical beats.
    const half = beat0HalfTime(input.beat.period)
    const beat = half
      ? { index: Math.floor(input.beat.index / 2), phase: ((input.beat.index & 1) + input.beat.phase) / 2, period: input.beat.period * 2 }
      : input.beat
    // Energy: loudness, smoothed, scaled by the style.
    const goal = Math.min(1, input.level * 1.25 * style.energy)
    this.energy += (goal - this.energy) * (1 - Math.exp(-dt / 0.25))
    this.accent = Math.max(input.onset, this.accent * Math.exp(-dt * 8))
    this.flash = Math.max(pulse(beat.phase) * Math.min(1, this.energy * 1.5), this.flash * Math.exp(-dt * 10))

    // A new clip every BEATS_PER_LOOP dance beats.
    const block = Math.floor(beat.index / BEATS_PER_LOOP)
    if (block !== Math.floor(this.moveStart / BEATS_PER_LOOP)) {
      this.prevClip = this.clip
      this.clip = this.choose()
      this.move = CLIPS[this.clip].name
      this.moveStart = block * BEATS_PER_LOOP
    }

    // Target pose: the clip at this point of the beat grid, crossfaded from the previous one.
    const beats = beat.index - this.moveStart + beat.phase
    const mix = Math.min(1, beats / CROSSFADE_BEATS)
    const amp = 0.15 + 0.85 * this.energy
    const t = this.target
    t.fill(0)
    if (mix < 1) this.sample(CLIPS[this.prevClip], beats, amp, t, 1 - mix)
    this.sample(CLIPS[this.clip], beats, amp, t, mix)
    // Onsets add a small lift of the whole body.
    const lift = 0.02 * this.accent * this.energy
    for (let k = 1; k < t.length; k += 2) t[k] += lift

    if (!this.started) {
      this.pos.set(t)
      this.started = true
    }
    // Damped springs with a speed limit, sub-stepped for stability.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    const h = dt / steps
    const J = JOINT_NAMES.length
    for (let n = 0; n < steps; n++) {
      for (let j = 0; j < J; j++) {
        const kx = 2 * j
        let vx = this.vel[kx] + (POSITION_SPRING * POSITION_SPRING * (t[kx] - this.pos[kx]) - 2 * POSITION_SPRING * this.vel[kx]) * h
        let vy = this.vel[kx + 1] + (POSITION_SPRING * POSITION_SPRING * (t[kx + 1] - this.pos[kx + 1]) - 2 * POSITION_SPRING * this.vel[kx + 1]) * h
        const sp = Math.hypot(vx, vy)
        if (sp > MAX_POINT_SPEED) {
          vx *= MAX_POINT_SPEED / sp
          vy *= MAX_POINT_SPEED / sp
        }
        this.vel[kx] = vx
        this.vel[kx + 1] = vy
        this.pos[kx] += vx * h
        this.pos[kx + 1] += vy * h
      }
    }

    // Colour follows the sound's brightness, smoothed so it glides.
    this.colourPos += (input.brightness - this.colourPos) * (1 - Math.exp(-dt / 0.4))
  }

  /** Picks the next clip: one whose own energy suits the music's, never the current one. */
  private choose(): number {
    const e = this.energy
    const w = CLIPS.map((c, i) => (i === this.clip ? 0 : 0.15 + Math.exp(-((c.energy - e) ** 2) / 0.12)))
    const total = w.reduce((a, b) => a + b, 0)
    let r = this.random() * total
    for (let i = 0; i < w.length; i++) {
      r -= w[i]
      if (r <= 0) return i
    }
    return 0
  }

  /** Colour of the figure at a given light level (never white: tubeColor caps it). */
  colour(temperature: number, light: number, variety: number): string {
    return tubeColor(temperature, 0.15, this.colourPos, 0, light, 0, variety)
  }
}

/** Whether a beat of this length (s) is fast enough to dance in half time. */
function beat0HalfTime(period: number): boolean {
  return period > 0 && 60 / period > HALF_TIME_BPM
}

/** Bones to draw, as chains of joints (each drawn as one tube). */
const CHAINS: (keyof Skeleton)[][] = [
  ['footL', 'kneeL', 'hipL', 'pelvis', 'hipR', 'kneeR', 'footR'],
  ['pelvis', 'neck'],
  ['handL', 'elbowL', 'shoulderL', 'neck', 'shoulderR', 'elbowR', 'handR'],
]

export interface Stage {
  /** Where the figure's feet stand, on screen. */
  x: number
  y: number
  /** Figure height on screen, px. */
  height: number
  /** Scene light 0..1 (the white rim's brightness, including blackouts). */
  light: number
  /** Camera roll, radians, applied around (rollX, rollY). */
  roll: number
  rollX: number
  rollY: number
}

/**
 * Draws the dancer as neon tubes (no halo): dark edge, body and lit core,
 * with round caps, and the head as a tube loop. Brightness is the scene
 * light, so the figure goes dark with the scene; it flashes on beats.
 */
export function drawDancer(
  ctx: CanvasRenderingContext2D,
  dancer: Dancer,
  stage: Stage,
  temperature: number,
  variety: number,
  thickness: number,
) {
  if (stage.light < 0.01) return
  const sk = dancer.skeleton()
  const H = stage.height
  const X = (j: Joint) => stage.x + j.x * H
  const Y = (j: Joint) => stage.y - j.y * H
  const width = Math.max(1.5, thickness * H)
  const light = stage.light * (1 + 0.6 * dancer.flash)

  const c = Math.cos(stage.roll)
  const s = Math.sin(stage.roll)
  ctx.save()
  ctx.setTransform(c, s, -s, c, stage.rollX - stage.rollX * c + stage.rollY * s, stage.rollY - stage.rollX * s - stage.rollY * c)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const trace = () => {
    ctx.beginPath()
    for (const chain of CHAINS) {
      chain.forEach((name, i) => {
        const j = sk[name]
        if (i === 0) ctx.moveTo(X(j), Y(j))
        else ctx.lineTo(X(j), Y(j))
      })
    }
    ctx.moveTo(X(sk.head) + HEAD_RADIUS * H, Y(sk.head))
    ctx.arc(X(sk.head), Y(sk.head), HEAD_RADIUS * H, 0, Math.PI * 2)
  }
  trace()
  // The cylinder, with no halo around it: dark edge, body, lit core.
  ctx.globalAlpha = 1
  ctx.strokeStyle = dancer.colour(temperature, light * 0.3, variety)
  ctx.lineWidth = width
  ctx.stroke()
  ctx.strokeStyle = dancer.colour(temperature, light * 0.8, variety)
  ctx.lineWidth = width * 0.7
  ctx.stroke()
  ctx.strokeStyle = dancer.colour(temperature, light * 1.15, variety)
  ctx.lineWidth = width * 0.32
  ctx.stroke()
  ctx.restore()
}
