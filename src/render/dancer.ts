import type { BeatPhase } from '../dsp/beats'
export type { Joint, Skeleton } from './dancerBody'
import { BEATS_PER_LOOP, DANCE_CLIPS, DANCE_JOINTS, SAMPLES_PER_BEAT } from './danceClips'
import { bodyPath, DEFAULT_THICKNESS, type Joint, type Skeleton } from './dancerBody'
import { paintSkin, type SkinName } from './dancerSkins'
import { detectStomp, handRaise } from './interaction'
import { tubeColor } from './tubeColor'

/** A new clip fades in over this many beats. */
const CROSSFADE_BEATS = 1
/** Above this tempo the dancer moves on every other beat (half time), as people do. */
const HALF_TIME_BPM = 130
/** Onsets stronger than this throw a hit accent. */
const HIT_THRESHOLD = 0.6
/** Below this light the dancer freezes mid-pose. */
const FREEZE_LIGHT = 0.05
/** A jump (on drops, and when the light returns) lasts this long (s) and rises this high (figure heights). */
const JUMP_TIME = 0.42
const JUMP_HEIGHT = 0.09

/** Accent on the beat: rises quickly but smoothly, then eases out over the beat. */
const pulse = (p: number) => Math.sin(Math.PI * Math.min(1, Math.pow(p, 0.6)))

export interface DancerInput {
  /** Beat grid, with index 0 on a downbeat so 8-beat phrases align with bars. */
  beat: BeatPhase
  /** True on the frame the music passes a drop. */
  drop?: boolean
  /** Scene light 0..1: the dancer freezes while it is dark (blackouts, silence). */
  light?: number
  /** Loudness 0..1. */
  level: number
  /** Onset strength this frame, 0..1. */
  onset: number
  /** Band energies 0..1 and brightness (spectral centroid) 0..1, for choosing moves and colour. */
  bass: number
  treble: number
  brightness: number
}

export type DanceStyleName = 'auto' | 'energetic' | 'smooth' | 'robotic'

export interface DancerStyle {
  /** Amplitude multiplier on the music's energy. */
  energy: number
  /** Character of the dancing (default 'auto'). */
  style?: DanceStyleName
}

/**
 * How each style moves: spring stiffness and speed limit (motion feel), how
 * strongly it prefers energetic or calm clips, amplitude, crossfade length,
 * and (robotic) how many times per beat the pose snaps to a new position.
 */
const STYLES: Record<DanceStyleName, { spring: number; maxSpeed: number; bias: number; amp: number; crossfade: number; steps: number }> = {
  auto: { spring: 18, maxSpeed: 3, bias: 0, amp: 1, crossfade: 1, steps: 0 },
  energetic: { spring: 22, maxSpeed: 3.6, bias: 2.2, amp: 1.12, crossfade: 0.75, steps: 0 },
  smooth: { spring: 10, maxSpeed: 2.2, bias: -2.2, amp: 0.95, crossfade: 2, steps: 0 },
  robotic: { spring: 90, maxSpeed: 12, bias: 0, amp: 1, crossfade: 0.5, steps: 4 },
}

/** Joint positions spring toward the clip with this stiffness (rad/s): smooths clip switches and seeks. */
/** Fastest any joint may move, figure heights per second (a quick human hand). */
export const MAX_POINT_SPEED = STYLES.auto.maxSpeed

const JOINT_NAMES = DANCE_JOINTS as readonly (keyof Skeleton)[]
/** Poses kept for trails and echoes (~1 s at 60 fps). */
const HISTORY = 72
const PELVIS = JOINT_NAMES.indexOf('pelvis')
const HEAD = JOINT_NAMES.indexOf('head')
const HANDS = [JOINT_NAMES.indexOf('handL'), JOINT_NAMES.indexOf('handR')]
const FEET = [JOINT_NAMES.indexOf('footL'), JOINT_NAMES.indexOf('footR')]
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
/** Relative motion energy of each clip (0 calmest … 1 most energetic). */
export const DANCE_CLIP_ENERGY: Record<string, number> = Object.fromEntries(CLIPS.map((c) => [c.name, c.energy]))

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
  /** Beat that phrases are counted from: 0 (a downbeat), or the last drop. */
  private anchor = 0
  /** Hit accent 0..1 (decays), and jump progress in seconds (−1 = not jumping). */
  private punch = 0
  private jumpT = -1
  /** Frozen in the dark; jumps back in when the light returns. */
  frozen = false
  /** Recent poses (ring buffer) for trails and echoes, with the time of each. */
  private readonly hist = new Float32Array(HISTORY * JOINT_NAMES.length * 2)
  private readonly histT = new Float64Array(HISTORY)
  private histHead = -1
  private histCount = 0
  private clock = 0
  /** Seconds the dancer has been running, for animated skins. */
  get time(): number {
    return this.clock
  }
  /** Current dance-beat length (s), for echoes timed in beats. */
  beatPeriod = 0.5
  /** Gestures from the last update, for the tubes: stomps this frame (side −1/+1, strength). */
  stomps: { side: number; strength: number }[] = []
  /** How far each hand is raised above the head, 0..1 (smoothed). */
  raisedL = 0
  raisedR = 0
  /** How energetically the dancer is moving, 0..1 (smoothed): it adds to the scene light. */
  glow = 0
  private readonly prevFootY = [0, 0]
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
  /** Clip preference of the current style (see STYLES). */
  private styleBias = 0
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

  /** Records the current pose in the history. */
  private record() {
    const J2 = JOINT_NAMES.length * 2
    this.histHead = (this.histHead + 1) % HISTORY
    this.hist.set(this.pos, this.histHead * J2)
    this.histT[this.histHead] = this.clock
    this.histCount = Math.min(HISTORY, this.histCount + 1)
  }

  /** Pose `age` seconds ago (nearest recorded frame), or null if older than the history. */
  pastSkeleton(age: number): Skeleton | null {
    if (this.histCount === 0) return null
    const J2 = JOINT_NAMES.length * 2
    const want = this.clock - age
    for (let n = 0; n < this.histCount; n++) {
      const i = (this.histHead - n + HISTORY) % HISTORY
      if (this.histT[i] <= want) {
        const sk = {} as Skeleton
        JOINT_NAMES.forEach((name, j) => (sk[name] = { x: this.hist[i * J2 + 2 * j], y: this.hist[i * J2 + 2 * j + 1] }))
        return sk
      }
    }
    return null
  }

  /** Path of one joint over the last `seconds`, newest first, as [x, y, age] triples. */
  jointTrail(joint: keyof Skeleton, seconds: number): number[] {
    const J2 = JOINT_NAMES.length * 2
    const j = JOINT_NAMES.indexOf(joint)
    const out: number[] = []
    for (let n = 0; n < this.histCount; n++) {
      const i = (this.histHead - n + HISTORY) % HISTORY
      const age = this.clock - this.histT[i]
      if (age > seconds) break
      out.push(this.hist[i * J2 + 2 * j], this.hist[i * J2 + 2 * j + 1], age)
    }
    return out
  }

  update(dt: number, input: DancerInput, style: DancerStyle) {
    this.clock += dt
    this.stomps = []
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

    this.beatPeriod = beat.period
    // Blackouts and silence: freeze mid-pose; jump back in when the light returns.
    const light = input.light ?? 1
    if (light < FREEZE_LIGHT) {
      this.frozen = true
      this.record()
      return
    }
    if (this.frozen && light > 0.3) {
      this.frozen = false
      this.jumpT = 0
    }

    // A drop: start a high-energy clip right now, with a jump.
    if (input.drop) {
      this.anchor = beat.index
      this.moveStart = -Infinity
      this.jumpT = 0
      this.energy = Math.max(this.energy, 0.9)
    }
    // A new clip every BEATS_PER_LOOP dance beats, counted from the anchor.
    const rel = beat.index - this.anchor
    const blockStart = this.anchor + Math.floor(rel / BEATS_PER_LOOP) * BEATS_PER_LOOP
    if (blockStart !== this.moveStart) {
      this.prevClip = this.clip
      this.clip = input.drop ? this.chooseBig() : this.choose()
      this.move = CLIPS[this.clip].name
      this.moveStart = blockStart
    }
    // Hit accents from strong onsets.
    if (input.onset > HIT_THRESHOLD) this.punch = Math.max(this.punch, input.onset)
    this.punch *= Math.exp(-dt * 7)
    if (this.jumpT >= 0) {
      this.jumpT += dt
      if (this.jumpT > JUMP_TIME) this.jumpT = -1
    }

    // Target pose: the clip at this point of the beat grid, crossfaded from the previous one.
    const st = STYLES[style.style ?? 'auto']
    this.styleBias = st.bias
    let beats = beat.index - this.moveStart + beat.phase
    // Robotic: hold the pose, then snap to the next position, `steps` times a beat.
    if (st.steps > 0) beats = Math.floor(beats * st.steps) / st.steps
    const mix = Math.min(1, beats / (CROSSFADE_BEATS * st.crossfade))
    const amp = Math.min(1.15, (0.15 + 0.85 * this.energy) * st.amp)
    const t = this.target
    t.fill(0)
    if (mix < 1) this.sample(CLIPS[this.prevClip], beats, amp, t, 1 - mix)
    this.sample(CLIPS[this.clip], beats, amp, t, mix)
    // Onsets add a small lift of the whole body; jumps lift everything, feet too.
    const jump = this.jumpT >= 0 ? JUMP_HEIGHT * Math.sin((Math.PI * this.jumpT) / JUMP_TIME) : 0
    const lift = 0.02 * this.accent * this.energy + jump
    for (let k = 1; k < t.length; k += 2) t[k] += lift
    // Hit accent: hands punch out and up, the body dips (feet stay planted).
    if (this.punch > 0.01) {
      const p = this.punch * (0.4 + 0.6 * this.energy)
      const pelvisX = t[2 * PELVIS]
      for (const h of HANDS) {
        t[2 * h] += Math.sign(t[2 * h] - pelvisX || 1) * 0.035 * p
        t[2 * h + 1] += 0.06 * p
      }
      for (let j = 0; j < JOINT_NAMES.length; j++) if (!FEET.includes(j) && !HANDS.includes(j)) t[2 * j + 1] -= 0.025 * p
    }

    if (!this.started) {
      this.pos.set(t)
      this.started = true
    }
    // Damped springs with a speed limit, sub-stepped for stability (finer for stiff styles).
    const steps = Math.max(1, Math.ceil(dt * Math.max(120, st.spring * 2.5)))
    const h = dt / steps
    const J = JOINT_NAMES.length
    for (let n = 0; n < steps; n++) {
      for (let j = 0; j < J; j++) {
        const kx = 2 * j
        const w = st.spring
        let vx = this.vel[kx] + (w * w * (t[kx] - this.pos[kx]) - 2 * w * this.vel[kx]) * h
        let vy = this.vel[kx + 1] + (w * w * (t[kx + 1] - this.pos[kx + 1]) - 2 * w * this.vel[kx + 1]) * h
        const sp = Math.hypot(vx, vy)
        if (sp > st.maxSpeed) {
          vx *= st.maxSpeed / sp
          vy *= st.maxSpeed / sp
        }
        this.vel[kx] = vx
        this.vel[kx + 1] = vy
        this.pos[kx] += vx * h
        this.pos[kx + 1] += vy * h
      }
    }

    // Colour follows the sound's brightness, smoothed so it glides.
    this.colourPos += (input.brightness - this.colourPos) * (1 - Math.exp(-dt / 0.4))
    this.gestures(dt)
    this.record()
  }

  /** Stomps, raised hands and motion energy, read from the pose for the tubes to react to. */
  private gestures(dt: number) {
    FEET.forEach((f, n) => {
      const y = this.pos[2 * f + 1]
      const s = detectStomp(this.prevFootY[n], y, this.vel[2 * f + 1])
      // Screen-left foot (footL) ripples on the left.
      if (s > 0) this.stomps.push({ side: n === 0 ? -1 : 1, strength: s })
      this.prevFootY[n] = y
    })
    const headY = this.pos[2 * HEAD + 1]
    const k = 1 - Math.exp(-dt / 0.12)
    this.raisedL += (handRaise(this.pos[2 * HANDS[0] + 1], headY) - this.raisedL) * k
    this.raisedR += (handRaise(this.pos[2 * HANDS[1] + 1], headY) - this.raisedR) * k
    let speed = 0
    for (let j = 0; j < JOINT_NAMES.length; j++) speed += Math.hypot(this.vel[2 * j], this.vel[2 * j + 1])
    const motion = Math.min(1, speed / JOINT_NAMES.length / 0.9)
    this.glow += (motion - this.glow) * (1 - Math.exp(-dt / 0.3))
  }

  /** For drops: one of the three most energetic clips (not the current one). */
  private chooseBig(): number {
    const ranked = CLIPS.map((c, i) => ({ i, e: c.energy })).filter((c) => c.i !== this.clip).sort((a, b) => b.e - a.e)
    return ranked[Math.floor(this.random() * Math.min(3, ranked.length))].i
  }

  /** Picks the next clip: one whose own energy suits the music's, never the current one. */
  private choose(): number {
    const e = this.energy
    // The style tilts the choice toward energetic (bias > 0) or calm (< 0) clips.
    const w = CLIPS.map((c, i) =>
      i === this.clip ? 0 : (0.15 + Math.exp(-((c.energy - e) ** 2) / 0.12)) * Math.exp(this.styleBias * (c.energy - 0.5)),
    )
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
 * Draws the dancer as a body of neon tubes (no halo): tapered limbs, a
 * waisted torso, neck and head, mitt hands and wedge feet, each shaded as a
 * dark edge, a body and a lit core, with a rim light on its outline. Brightness is the scene
 * light, so the figure goes dark with the scene; it flashes on beats.
 */
export interface DancerEffects {
  /** Light-painting trails from the hands and feet, 0..1. */
  trails: number
  /** Fading copies of the body a quarter and half beat behind, 0..1. */
  echoes: number
  /** Mirror image on the crater floor, 0..1. */
  reflection: number
  /** The look of the body (default neon). */
  skin?: SkinName
}

/**
 * Draws the dancer: light-painting trails, echoes and a floor reflection
 * behind it, then the body itself — tapered limbs, a waisted torso, neck,
 * head, mitt hands and wedge feet, shaded as a dark edge, a body and a lit
 * core, with a rim light on its silhouette. Brightness is the scene light,
 * so everything goes dark with the scene; it flashes on beats.
 */
export function drawDancer(
  ctx: CanvasRenderingContext2D,
  dancer: Dancer,
  stage: Stage,
  temperature: number,
  variety: number,
  thickness: number,
  fx: DancerEffects = { trails: 0, echoes: 0, reflection: 0 },
) {
  if (stage.light < 0.01) return
  const sk = dancer.skeleton()
  const H = stage.height
  const X = (j: Joint) => stage.x + j.x * H
  const Y = (j: Joint) => stage.y - j.y * H
  const light = stage.light * (1 + 0.6 * dancer.flash)
  const k = thickness / DEFAULT_THICKNESS
  const colour = (l: number) => dancer.colour(temperature, l, variety)

  const c = Math.cos(stage.roll)
  const s = Math.sin(stage.roll)
  ctx.save()
  ctx.setTransform(c, s, -s, c, stage.rollX - stage.rollX * c + stage.rollY * s, stage.rollY - stage.rollX * s - stage.rollY * c)

  // Reflection on the crater floor: the body mirrored below the feet,
  // squashed by the viewing angle, faint.
  if (fx.reflection > 0.01) {
    ctx.save()
    ctx.translate(0, stage.y)
    ctx.scale(1, -0.42)
    ctx.translate(0, -stage.y)
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(1, 0.22 * fx.reflection * stage.light)
    ctx.fillStyle = colour(light * 0.8)
    ctx.fill(bodyPath(sk, X, Y, H, k, 1), 'nonzero')
    ctx.restore()
  }

  // Echoes: fading copies a quarter and a half beat behind.
  if (fx.echoes > 0.01) {
    ctx.globalCompositeOperation = 'lighter'
    for (const [beats, alpha] of [[0.5, 0.22], [0.25, 0.34]] as const) {
      const past = dancer.pastSkeleton(beats * dancer.beatPeriod)
      if (!past) continue
      ctx.globalAlpha = Math.min(1, alpha * fx.echoes * stage.light)
      ctx.fillStyle = colour(light * 0.9)
      ctx.fill(bodyPath(past, X, Y, H, k, 0.85), 'nonzero')
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  // Light-painting trails from the hands and feet: tapering, fading streaks.
  if (fx.trails > 0.01) {
    const seconds = 0.3 + 0.6 * fx.trails
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (const joint of ['handL', 'handR', 'footL', 'footR'] as const) {
      const tr = dancer.jointTrail(joint, seconds)
      for (let n = 3; n < tr.length; n += 3) {
        const fade = 1 - tr[n + 2] / seconds
        if (fade <= 0) break
        ctx.globalAlpha = Math.min(1, 1.1 * fade * fx.trails * stage.light)
        ctx.strokeStyle = colour(light * (0.9 + 0.4 * fade))
        ctx.lineWidth = Math.max(1, 0.04 * k * H * (0.25 + 0.75 * fade))
        ctx.beginPath()
        ctx.moveTo(stage.x + tr[n - 3] * H, stage.y - tr[n - 2] * H)
        ctx.lineTo(stage.x + tr[n] * H, stage.y - tr[n + 1] * H)
        ctx.stroke()
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  // The body itself, in the chosen skin.
  paintSkin(fx.skin ?? 'neon', { ctx, sk, X, Y, H, k, colour, light, sceneLight: stage.light, time: dancer.time })
  ctx.restore()
}
