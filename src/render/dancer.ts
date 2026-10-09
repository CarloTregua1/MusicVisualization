import type { BeatPhase } from '../dsp/beats'
import { tubeColor } from './tubeColor'

/** Bone lengths in figure heights (the figure is about 1 unit tall). */
const BONES = {
  torso: 0.3,
  neck: 0.05,
  headRadius: 0.065,
  upperArm: 0.15,
  forearm: 0.14,
  thigh: 0.22,
  shin: 0.22,
  shoulderHalf: 0.09,
  hipHalf: 0.05,
}

/** Moves switch only on multiples of this many beats. */
export const BEATS_PER_MOVE = 8
/** A new move fades in over this fraction of a beat. */
const CROSSFADE_BEATS = 0.5
/** How quickly joints follow their targets (s): smooths every change without lag. */
const FOLLOW = 0.035

export type MoveName = 'idle' | 'bounce' | 'pump' | 'sidestep' | 'wave' | 'jump'
const DANCE_MOVES: MoveName[] = ['bounce', 'pump', 'sidestep', 'wave', 'jump']

/**
 * A pose as joint angles (radians) plus a little body translation. Arm and
 * leg angles are measured from hanging straight down; positive raises the
 * limb outward, away from the body. Bends are always ≥ 0.
 */
export interface Pose {
  /** Sideways shift of the pelvis, figure heights. */
  sway: number
  /** Extra lift of the whole body (jumps), figure heights. */
  lift: number
  /** Torso lean, radians (positive leans to the figure's right / screen right). */
  lean: number
  /** Head tilt relative to the torso. */
  nod: number
  armL: number
  armR: number
  elbowL: number
  elbowR: number
  legL: number
  legR: number
  kneeL: number
  kneeR: number
}

const IDLE: Pose = {
  sway: 0,
  lift: 0,
  lean: 0,
  nod: 0,
  armL: 0.18,
  armR: 0.18,
  elbowL: 0.35,
  elbowR: 0.35,
  legL: 0.08,
  legR: 0.08,
  kneeL: 0.12,
  kneeR: 0.12,
}

const KEYS = Object.keys(IDLE) as (keyof Pose)[]

/** Sharp hit on the beat that decays over it. */
const pulse = (p: number) => Math.exp(-6 * p)
/** Smooth 0 → 1 → 0 over the beat. */
const swell = (p: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * p)

/**
 * Target pose of a move at beat phase p (0..1), on beat `index`, with energy
 * e (0 = barely moving, 1 = full out). Every move collapses toward IDLE as
 * e → 0.
 */
export function movePose(move: MoveName, p: number, index: number, e: number): Pose {
  const q: Pose = { ...IDLE }
  const side = index % 2 === 0 ? 1 : -1
  const hit = pulse(p) * e
  switch (move) {
    case 'idle':
      q.sway = 0.015 * Math.sin(Math.PI * (index + p)) * (0.4 + e)
      q.nod = 0.06 * hit
      break
    case 'bounce':
      // Down on the beat: knees bend, head nods, bent arms swing with it.
      q.kneeL = q.kneeR = 0.12 + 0.75 * hit
      q.legL = q.legR = 0.08 + 0.18 * hit
      q.nod = 0.3 * hit
      q.elbowL = q.elbowR = 0.35 + 1.2 * e
      q.armL = q.armR = 0.25 + 0.35 * hit
      break
    case 'pump': {
      // Alternate arms punch up on the beat, with a small bounce.
      const up = side > 0 ? 'L' : 'R'
      const down = side > 0 ? 'R' : 'L'
      q[`arm${up}`] = 0.3 + (2.6 - 0.3) * e * (1 - 0.35 * p)
      q[`elbow${up}`] = 0.15
      q[`arm${down}`] = 0.3
      q[`elbow${down}`] = 0.4 + 1.3 * e
      q.kneeL = q.kneeR = 0.12 + 0.45 * hit
      q.lean = -0.08 * side * e
      q.nod = 0.2 * hit
      break
    }
    case 'sidestep': {
      // Weight shifts side to side on alternate beats; arms swing against it.
      const s = side * (1 - 2 * swell(p * 0.5))
      q.sway = 0.07 * s * e
      q.lean = -0.12 * s * e
      q.legL = 0.08 + Math.max(0, 0.35 * s) * e
      q.legR = 0.08 + Math.max(0, -0.35 * s) * e
      q.kneeL = q.kneeR = 0.15 + 0.35 * hit
      q.armL = 0.25 + Math.max(0, 0.7 * -s) * e
      q.armR = 0.25 + Math.max(0, 0.7 * s) * e
      q.elbowL = q.elbowR = 0.6 + 0.6 * e
      break
    }
    case 'wave': {
      // Raised arms flow in a wave that passes from one side to the other.
      const w = 2 * Math.PI * (p + (index % 2) * 0.5)
      q.armL = 1.4 + e * (0.6 + 0.5 * Math.sin(w))
      q.armR = 1.4 + e * (0.6 + 0.5 * Math.sin(w + Math.PI))
      q.elbowL = 0.4 + 0.6 * e * (0.5 + 0.5 * Math.sin(w + 1))
      q.elbowR = 0.4 + 0.6 * e * (0.5 + 0.5 * Math.sin(w + Math.PI + 1))
      q.sway = 0.04 * Math.sin(w) * e
      q.lean = 0.1 * Math.sin(w) * e
      q.kneeL = q.kneeR = 0.15 + 0.3 * swell(p) * e
      break
    }
    case 'jump':
      // Hands up and a lift right after the beat, knees tucking in the air.
      q.lift = 0.09 * Math.sin(Math.PI * Math.min(1, p * 1.6)) * e
      q.armL = q.armR = 0.4 + 2.4 * e * (1 - 0.3 * p)
      q.elbowL = q.elbowR = 0.2
      q.kneeL = q.kneeR = 0.12 + (q.lift > 0.01 ? 0.9 * e * Math.sin(Math.PI * Math.min(1, p * 1.6)) : 0.5 * hit)
      q.legL = q.legR = 0.1 + 0.15 * e
      break
  }
  return q
}

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

/**
 * Forward kinematics, in figure units with y pointing up and the ground at
 * y = 0. The pelvis height is set so the lower foot rests on the ground
 * (plus any jump lift), so bending knees makes the body drop naturally.
 */
export function solveSkeleton(q: Pose): Skeleton {
  const B = BONES
  // Legs seen from the front: a knee bend pushes the knee outward and brings
  // the shin back under the hip (like a squat), so the body drops while every
  // bone keeps its length.
  const leg = (angle: number, knee: number, dir: number) => {
    const thighA = (angle + knee * 0.5) * dir
    const shinA = (angle - knee * 0.5) * dir
    const kx = Math.sin(thighA) * B.thigh
    const ky = -Math.cos(thighA) * B.thigh
    return { kx, ky, fx: kx + Math.sin(shinA) * B.shin, fy: ky - Math.cos(shinA) * B.shin }
  }
  const L = leg(q.legL, q.kneeL, -1)
  const R = leg(q.legR, q.kneeR, 1)
  const pelvisY = Math.max(-L.fy, -R.fy) + q.lift
  const pelvis = { x: q.sway, y: pelvisY }
  const hipL = { x: pelvis.x - B.hipHalf, y: pelvis.y }
  const hipR = { x: pelvis.x + B.hipHalf, y: pelvis.y }
  const kneeL = { x: hipL.x + L.kx, y: hipL.y + L.ky }
  const kneeR = { x: hipR.x + R.kx, y: hipR.y + R.ky }
  const footL = { x: hipL.x + L.fx, y: hipL.y + L.fy }
  const footR = { x: hipR.x + R.fx, y: hipR.y + R.fy }

  // Torso leans around the pelvis.
  const tx = Math.sin(q.lean)
  const ty = Math.cos(q.lean)
  const neck = { x: pelvis.x + tx * B.torso, y: pelvis.y + ty * B.torso }
  const nx = Math.sin(q.lean + q.nod * 0.5)
  const ny = Math.cos(q.lean + q.nod * 0.5)
  const head = { x: neck.x + nx * (B.neck + B.headRadius), y: neck.y + ny * (B.neck + B.headRadius) - q.nod * 0.02 }
  // Shoulders sit across the top of the torso, perpendicular to it.
  const shoulderL = { x: neck.x - ty * B.shoulderHalf, y: neck.y + tx * B.shoulderHalf - 0.02 }
  const shoulderR = { x: neck.x + ty * B.shoulderHalf, y: neck.y - tx * B.shoulderHalf - 0.02 }
  const arm = (s: Joint, angle: number, elbow: number, dir: number) => {
    const a1 = q.lean + angle * dir
    const e = { x: s.x + Math.sin(a1) * B.upperArm, y: s.y - Math.cos(a1) * B.upperArm }
    // Elbows bend the forearm back toward the body's midline.
    const a2 = a1 - elbow * dir
    const h = { x: e.x + Math.sin(a2) * B.forearm, y: e.y - Math.cos(a2) * B.forearm }
    return { e, h }
  }
  const aL = arm(shoulderL, q.armL, q.elbowL, -1)
  const aR = arm(shoulderR, q.armR, q.elbowR, 1)
  return {
    head,
    neck,
    pelvis,
    shoulderL,
    shoulderR,
    elbowL: aL.e,
    elbowR: aR.e,
    handL: aL.h,
    handR: aR.h,
    hipL,
    hipR,
    kneeL,
    kneeR,
    footL,
    footR,
  }
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

/**
 * A neon dancer for the crater. Each frame it reads the beat phase and the
 * music's character, picks a move every BEATS_PER_MOVE beats (bass-heavy →
 * bounce/pump, bright and loud → wave/jump), blends to it over half a beat,
 * and eases every joint toward the move's pose so nothing ever snaps.
 */
export class Dancer {
  move: MoveName = 'idle'
  private prevMove: MoveName = 'idle'
  /** Beat index at which the current move started. */
  private moveStart = -Infinity
  private pose: Pose = { ...IDLE }
  private energy = 0
  private accent = 0
  /** Colour position (0 bass pink … 1 treble mint), smoothed. */
  colourPos = 0.3
  /** Brightness boost right after each beat, 0..1. */
  flash = 0
  /** Random source for move choice; replaceable in tests. */
  random: () => number = Math.random

  get currentPose(): Pose {
    return this.pose
  }

  update(dt: number, input: DancerInput, style: DancerStyle) {
    const { beat } = input
    // Energy: loudness, smoothed, scaled by the style.
    const target = Math.min(1, input.level * 1.25 * style.energy)
    this.energy += (target - this.energy) * (1 - Math.exp(-dt / 0.25))
    this.accent = Math.max(input.onset, this.accent * Math.exp(-dt * 8))
    this.flash = Math.max(pulse(beat.phase) * Math.min(1, this.energy * 1.5), this.flash * Math.exp(-dt * 10))

    // New move on 8-beat boundaries.
    const block = Math.floor(beat.index / BEATS_PER_MOVE)
    if (block !== Math.floor(this.moveStart / BEATS_PER_MOVE)) {
      this.prevMove = this.move
      this.move = this.energy < 0.08 ? 'idle' : this.choose(input)
      this.moveStart = block * BEATS_PER_MOVE
    }

    // Blend from the previous move over the first half beat of a new move.
    const intoMove = beat.index - this.moveStart + beat.phase
    const mix = Math.min(1, intoMove / CROSSFADE_BEATS)
    const e = this.energy
    const a = movePose(this.prevMove, beat.phase, beat.index, e)
    const b = movePose(this.move, beat.phase, beat.index, e)
    const k = 1 - Math.exp(-dt / FOLLOW)
    for (const key of KEYS) {
      let goal = a[key] + (b[key] - a[key]) * mix
      // Onsets add a quick extra lift and flare.
      if (key === 'lift') goal += 0.025 * this.accent * e
      if (key === 'armL' || key === 'armR') goal += 0.25 * this.accent * e
      this.pose[key] += (goal - this.pose[key]) * k
    }

    // Colour follows the sound's brightness, smoothed so it glides.
    this.colourPos += (input.brightness - this.colourPos) * (1 - Math.exp(-dt / 0.4))
  }

  /** Picks the next move from the music's character, never repeating the current one. */
  private choose(input: DancerInput): MoveName {
    const e = this.energy
    const w: Record<MoveName, number> = {
      idle: 0,
      bounce: 0.6 + 1.2 * input.bass,
      pump: 0.3 + 1.2 * input.bass * e,
      sidestep: 0.7,
      wave: 0.3 + 1.4 * input.brightness,
      jump: 0.1 + 1.6 * e * e * (0.5 + input.treble),
    }
    w[this.move] = 0
    let total = 0
    for (const m of DANCE_MOVES) total += w[m]
    let r = this.random() * total
    for (const m of DANCE_MOVES) {
      r -= w[m]
      if (r <= 0) return m
    }
    return 'bounce'
  }

  /** Colour of the figure at a given light level (never white: tubeColor caps it). */
  colour(temperature: number, light: number, variety: number): string {
    return tubeColor(temperature, 0.15, this.colourPos, 0, light, 0, variety)
  }
}

/** Bones to draw, as chains of joints (each drawn as one tube). */
const CHAINS: (keyof Skeleton)[][] = [
  ['footL', 'kneeL', 'hipL', 'hipR', 'kneeR', 'footR'],
  ['pelvis', 'neck'],
  ['handL', 'elbowL', 'shoulderL', 'shoulderR', 'elbowR', 'handR'],
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
  const sk = solveSkeleton(dancer.currentPose)
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
    ctx.moveTo(X(sk.head) + BONES.headRadius * H, Y(sk.head))
    ctx.arc(X(sk.head), Y(sk.head), BONES.headRadius * H, 0, Math.PI * 2)
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
