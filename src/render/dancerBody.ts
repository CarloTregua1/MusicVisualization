/** Body geometry for the dancer: joints, and the tapered-capsule body shape every skin builds on. */

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

/** Head radius in figure heights (the figure is about 1 unit tall). */
export const HEAD_RADIUS = 0.065

/**
 * Limb radii in figure heights, tapered like a body: each bone runs from its
 * radius at the first joint to its radius at the second.
 */
export const LIMBS: [keyof Skeleton, keyof Skeleton, number, number][] = [
  ['hipL', 'kneeL', 0.05, 0.036],
  ['kneeL', 'footL', 0.034, 0.022],
  ['hipR', 'kneeR', 0.05, 0.036],
  ['kneeR', 'footR', 0.034, 0.022],
  ['shoulderL', 'elbowL', 0.034, 0.026],
  ['elbowL', 'handL', 0.025, 0.018],
  ['shoulderR', 'elbowR', 0.034, 0.026],
  ['elbowR', 'handR', 0.025, 0.018],
]
/** Neck radius, and the default limb scale the thickness setting is relative to. */
export const NECK_RADIUS = 0.022
export const DEFAULT_THICKNESS = 0.035

/** Path of a tapered capsule: circles of radius ra at a and rb at b, joined by tangent-ish sides. */
export function capsule(path: Path2D, ax: number, ay: number, ra: number, bx: number, by: number, rb: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1e-6
  const ang = Math.atan2(dy, dx)
  // Angle of the side lines for circles of different radii (external tangents).
  const off = Math.acos(Math.max(-1, Math.min(1, (ra - rb) / len)))
  path.moveTo(ax + ra * Math.cos(ang + off), ay + ra * Math.sin(ang + off))
  path.arc(ax, ay, ra, ang + off, ang - off + 2 * Math.PI, false)
  path.arc(bx, by, rb, ang - off, ang + off, false)
  path.closePath()
}

/**
 * A smooth, slightly waisted torso from shoulders to hips, shrunk toward its
 * centre by `scale` (so inner shading layers sit inside the silhouette).
 */
export function torso(path: Path2D, sk: Skeleton, X0: (j: Joint) => number, Y0: (j: Joint) => number, scale: number) {
  const c = {
    x: (sk.shoulderL.x + sk.shoulderR.x + sk.hipL.x + sk.hipR.x) / 4,
    y: (sk.shoulderL.y + sk.shoulderR.y + sk.hipL.y + sk.hipR.y) / 4,
  }
  // Shrink more across than along the body, so the core stays a long stripe.
  const sx = scale
  const sy = 1 - (1 - scale) * 0.45
  const X = (j: Joint) => X0({ x: c.x + (j.x - c.x) * sx, y: c.y + (j.y - c.y) * sy })
  const Y = (j: Joint) => Y0({ x: c.x + (j.x - c.x) * sx, y: c.y + (j.y - c.y) * sy })
  const sL = sk.shoulderL
  const sR = sk.shoulderR
  const hL = sk.hipL
  const hR = sk.hipR
  const mid = (a: Joint, b: Joint, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  // Waist: 60% of the way down, pulled in a little toward the spine.
  const wL = mid(sL, hL, 0.6)
  const wR = mid(sR, hR, 0.6)
  const spine = mid(mid(sL, sR, 0.5), mid(hL, hR, 0.5), 0.6)
  const pinch = 0.18
  const inL = { x: wL.x + (spine.x - wL.x) * pinch, y: wL.y }
  const inR = { x: wR.x + (spine.x - wR.x) * pinch, y: wR.y }
  // Shoulders extend slightly past the joints, hips slightly past the hip joints.
  const out = (a: Joint, b: Joint, k: number) => ({ x: a.x + (a.x - b.x) * k, y: a.y + (a.y - b.y) * k })
  const sl = out(sL, sR, 0.12)
  const sr = out(sR, sL, 0.12)
  const hl = out(hL, hR, 0.35)
  const hr = out(hR, hL, 0.35)
  path.moveTo(X(sl), Y(sl))
  path.quadraticCurveTo(X(mid(sl, sr, 0.5)), Y(mid(sl, sr, 0.5)), X(sr), Y(sr))
  path.quadraticCurveTo(X(inR), Y(inR), X(hr), Y(hr))
  path.lineTo(X(hl), Y(hl))
  path.quadraticCurveTo(X(inL), Y(inL), X(sl), Y(sl))
  path.closePath()
}

/** Body as filled shapes at a given scale of every radius (1 = silhouette). */
export function bodyPath(sk: Skeleton, X: (j: Joint) => number, Y: (j: Joint) => number, H: number, k: number, scale: number): Path2D {
  const p = new Path2D()
  for (const [a, b, ra, rb] of LIMBS) capsule(p, X(sk[a]), Y(sk[a]), ra * k * H * scale, X(sk[b]), Y(sk[b]), rb * k * H * scale)
  capsule(p, X(sk.neck), Y(sk.neck), NECK_RADIUS * k * H * scale, X(sk.head), Y(sk.head), NECK_RADIUS * k * H * scale)
  torso(p, sk, X, Y, scale)
  // Hands: small mitts carried on past the wrist along the forearm.
  for (const [e, h] of [['elbowL', 'handL'], ['elbowR', 'handR']] as const) {
    const dx = sk[h].x - sk[e].x
    const dy = sk[h].y - sk[e].y
    const len = Math.hypot(dx, dy) || 1
    const tip = { x: sk[h].x + (dx / len) * 0.045, y: sk[h].y + (dy / len) * 0.045 }
    capsule(p, X(sk[h]), Y(sk[h]), 0.02 * k * H * scale, X(tip), Y(tip), 0.016 * k * H * scale)
  }
  // Feet: short wedges pointing slightly outward, resting on the ankle.
  for (const [f, dir] of [['footL', -1], ['footR', 1]] as const) {
    const toe = { x: sk[f].x + dir * 0.05, y: sk[f].y - 0.012 }
    capsule(p, X(sk[f]), Y(sk[f]), 0.022 * k * H * scale, X(toe), Y(toe), 0.014 * k * H * scale)
  }
  const hr = HEAD_RADIUS * H * Math.max(0.55, scale)
  p.moveTo(X(sk.head) + hr, Y(sk.head))
  p.arc(X(sk.head), Y(sk.head), hr, 0, Math.PI * 2)
  return p
}

