import { bodyPath, HEAD_RADIUS, type Joint, type Skeleton } from './dancerBody'

/** The looks the dancer can wear. */
export const SKINS = ['neon', 'outline', 'silhouette', 'hologram', 'chrome', 'constellation', 'robot', 'adventurer'] as const
export type SkinName = (typeof SKINS)[number]

/** Cut-out character skins: Kenney "Toon Characters 1" parts (CC0), served from public/skins/<name>/. */
const SPRITE_SKINS: Partial<Record<SkinName, string>> = { robot: 'robot', adventurer: 'adventurer' }
const PARTS = ['head', 'body', 'arm', 'hand', 'leg', 'legBend'] as const
type Part = (typeof PARTS)[number]
type Sprites = Record<Part, CanvasImageSource & { width: number; height: number }>

const loaded: Partial<Record<SkinName, Sprites>> = {}
const loading = new Set<SkinName>()

/** Provides sprite images directly (tests / offline rendering). */
export function setSkinSprites(skin: SkinName, sprites: Sprites) {
  loaded[skin] = sprites
}

/** Starts loading a sprite skin's images in the browser; until ready, the neon body stands in. */
function sprites(skin: SkinName): Sprites | null {
  const dir = SPRITE_SKINS[skin]
  if (!dir) return null
  if (loaded[skin]) return loaded[skin]!
  if (!loading.has(skin) && typeof Image !== 'undefined') {
    loading.add(skin)
    const imgs = {} as Record<Part, HTMLImageElement>
    let done = 0
    for (const p of PARTS) {
      const img = new Image()
      img.onload = () => {
        if (++done === PARTS.length) loaded[skin] = imgs
      }
      img.src = `${import.meta.env.BASE_URL}skins/${dir}/${p}.png`
      imgs[p] = img
    }
  }
  return null
}

export interface SkinContext {
  ctx: CanvasRenderingContext2D
  sk: Skeleton
  X: (j: Joint) => number
  Y: (j: Joint) => number
  /** Figure height on screen, px. */
  H: number
  /** Limb thickness scale. */
  k: number
  /** Colour at a lightness factor (the dancer's neon colour; never white). */
  colour: (light: number) => string
  /** Brightness including beat flashes, and the bare scene light 0..1. */
  light: number
  sceneLight: number
  /** Seconds, for animated skins. */
  time: number
}

/** Paints the dancer's body in the given skin (effects like trails are drawn by the caller). */
export function paintSkin(skin: SkinName, c: SkinContext) {
  const spr = sprites(skin)
  if (SPRITE_SKINS[skin] && spr) return paintSprites(c, spr)
  switch (skin) {
    case 'outline':
      return paintOutline(c)
    case 'silhouette':
      return paintSilhouette(c)
    case 'hologram':
      return paintHologram(c)
    case 'chrome':
      return paintChrome(c)
    case 'constellation':
      return paintConstellation(c)
    default:
      return paintNeon(c)
  }
}

const body = (c: SkinContext, scale: number) => bodyPath(c.sk, c.X, c.Y, c.H, c.k, scale)

/** Glossy neon: a rim-lit body shaded as a dark edge, a body and a lit core. */
function paintNeon(c: SkinContext) {
  const { ctx, colour, light } = c
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.6 * c.sceneLight)
  ctx.fillStyle = colour(light * 1.2)
  ctx.fill(body(c, 1.14), 'nonzero')
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = colour(light * 0.28)
  ctx.fill(body(c, 1), 'nonzero')
  ctx.fillStyle = colour(light * 0.7)
  ctx.fill(body(c, 0.72), 'nonzero')
  ctx.fillStyle = colour(light * 1.05)
  ctx.fill(body(c, 0.38), 'nonzero')
}

/** Neon contour: only the outline of the body, as one glowing tube (no lines where limbs overlap). */
function paintOutline(c: SkinContext) {
  const { ctx, colour, light } = c
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.35 * c.sceneLight)
  ctx.fillStyle = colour(light * 1.1)
  ctx.fill(body(c, 1.35), 'nonzero')
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = colour(light * 1.15)
  ctx.fill(body(c, 1.08), 'nonzero')
  // Hollow it out: the inside is the dark crater.
  ctx.fillStyle = '#030305'
  ctx.fill(body(c, 0.78), 'nonzero')
}

/** Backlit silhouette: a near-black body with a bright rim, as if the white rim were behind it. */
function paintSilhouette(c: SkinContext) {
  const { ctx, colour, light } = c
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.5 * c.sceneLight)
  ctx.fillStyle = colour(light * 1.1)
  ctx.fill(body(c, 1.28), 'nonzero')
  ctx.globalAlpha = Math.min(1, 0.9 * c.sceneLight)
  ctx.fillStyle = colour(light * 1.3)
  ctx.fill(body(c, 1.08), 'nonzero')
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#05050a'
  ctx.fill(body(c, 1), 'nonzero')
}

/** Hologram: translucent body with moving scanlines and a flickering edge. */
function paintHologram(c: SkinContext) {
  const { ctx, colour, light, time } = c
  const flicker = 0.85 + 0.15 * Math.sin(time * 37) * Math.sin(time * 13)
  const silhouette = body(c, 1)
  ctx.save()
  ctx.clip(silhouette, 'nonzero')
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.28 * c.sceneLight * flicker)
  ctx.fillStyle = colour(light)
  ctx.fill(silhouette, 'nonzero')
  // Scanlines drifting upward.
  const top = c.Y(c.sk.head) - HEAD_RADIUS * c.H * 1.4
  const bottom = Math.max(c.Y(c.sk.footL), c.Y(c.sk.footR)) + 0.03 * c.H
  const gap = Math.max(3, c.H * 0.018)
  const offset = (time * gap * 3) % gap
  ctx.globalAlpha = Math.min(1, 0.55 * c.sceneLight * flicker)
  ctx.strokeStyle = colour(light * 1.2)
  ctx.lineWidth = Math.max(1, gap * 0.35)
  ctx.beginPath()
  const left = Math.min(c.X(c.sk.handL), c.X(c.sk.footL), c.X(c.sk.shoulderL)) - c.H * 0.2
  const right = Math.max(c.X(c.sk.handR), c.X(c.sk.footR), c.X(c.sk.shoulderR)) + c.H * 0.2
  for (let y = bottom - offset; y > top; y -= gap) {
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
  }
  ctx.stroke()
  ctx.restore()
  // Bright edge.
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.8 * c.sceneLight * flicker)
  ctx.strokeStyle = colour(light * 1.25)
  ctx.lineWidth = Math.max(1, c.H * 0.006)
  ctx.stroke(silhouette)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** Chrome: a metallic body, a vertical sky-to-ground gradient tinted by the dancer's colour, with a specular streak. */
function paintChrome(c: SkinContext) {
  const { ctx, colour, light } = c
  const top = c.Y(c.sk.head) - HEAD_RADIUS * c.H
  const bottom = Math.max(c.Y(c.sk.footL), c.Y(c.sk.footR))
  const g = ctx.createLinearGradient(0, top, 0, bottom)
  g.addColorStop(0, `rgba(235,240,255,${Math.min(1, light).toFixed(2)})`)
  g.addColorStop(0.35, colour(light * 0.75))
  g.addColorStop(0.5, '#0b0b14')
  g.addColorStop(0.62, colour(light * 1.05))
  g.addColorStop(1, '#14141e')
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.4 * c.sceneLight)
  ctx.fillStyle = colour(light)
  ctx.fill(body(c, 1.12), 'nonzero')
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = g
  ctx.fill(body(c, 1), 'nonzero')
  ctx.globalAlpha = Math.min(1, 0.7 * c.sceneLight)
  ctx.fillStyle = `rgba(255,255,255,${(0.5 * Math.min(1, light)).toFixed(2)})`
  ctx.fill(body(c, 0.22), 'nonzero')
  ctx.globalAlpha = 1
}

/** Constellation: joints as stars, bones as faint threads between them. */
function paintConstellation(c: SkinContext) {
  const { ctx, sk, X, Y, colour, light } = c
  const bones: [keyof Skeleton, keyof Skeleton][] = [
    ['head', 'neck'], ['neck', 'pelvis'], ['neck', 'shoulderL'], ['neck', 'shoulderR'],
    ['shoulderL', 'elbowL'], ['elbowL', 'handL'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'],
    ['pelvis', 'hipL'], ['pelvis', 'hipR'], ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR'],
  ]
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.55 * c.sceneLight)
  ctx.strokeStyle = colour(light * 0.9)
  ctx.lineWidth = Math.max(1, c.H * 0.006)
  ctx.beginPath()
  for (const [a, b] of bones) {
    ctx.moveTo(X(sk[a]), Y(sk[a]))
    ctx.lineTo(X(sk[b]), Y(sk[b]))
  }
  ctx.stroke()
  for (const name of Object.keys(sk) as (keyof Skeleton)[]) {
    const big = name === 'head' || name.startsWith('hand') || name.startsWith('foot')
    const r = c.H * (big ? 0.028 : 0.016)
    const x = X(sk[name])
    const y = Y(sk[name])
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3)
    g.addColorStop(0, colour(light * 1.3))
    g.addColorStop(0.25, colour(light * 1.1))
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = Math.min(1, c.sceneLight)
    ctx.fillStyle = g
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6)
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/**
 * Cut-out character: each part image is pinned to its bones. Arms and legs
 * are single images from the shoulder to the hand / hip to the foot, rotated
 * and stretched along that line (the bent leg image when the knee bends);
 * screen-left limbs are mirrored. A soft neon rim keeps it in the scene.
 */
function paintSprites(c: SkinContext, spr: Sprites) {
  const { ctx, sk, X, Y, H } = c
  const lit = Math.min(1, 0.25 + 0.85 * c.sceneLight)
  // Rim glow around the figure, in the dancer's colour.
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.4 * c.sceneLight)
  ctx.fillStyle = c.colour(c.light * 1.1)
  ctx.fill(bodyPath(sk, X, Y, H, c.k * 1.5, 1.2), 'nonzero')
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = lit
  /** Draws image `img` so its top-centre sits at a and its bottom-centre at b; `width` px wide. */
  const along = (img: Sprites[Part], a: Joint, b: Joint, width: number, mirror: boolean, extend = 0.12) => {
    const ax = X(a)
    const ay = Y(a)
    const bx = X(b)
    const by = Y(b)
    const len = Math.hypot(bx - ax, by - ay) * (1 + extend)
    const ang = Math.atan2(by - ay, bx - ax) - Math.PI / 2
    ctx.save()
    ctx.translate(ax, ay)
    ctx.rotate(ang)
    ctx.scale(mirror ? -1 : 1, 1)
    ctx.drawImage(img, -width / 2, -len * extend * 0.5, width, len)
    ctx.restore()
  }
  const kneeBend = (hip: Joint, knee: Joint, foot: Joint) => {
    const a1 = Math.atan2(knee.y - hip.y, knee.x - hip.x)
    const a2 = Math.atan2(foot.y - knee.y, foot.x - knee.x)
    return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)))
  }
  const limbW = H * 0.11
  // Legs (bent image when the knee bends), then body, arms, hands, head.
  for (const [hip, knee, foot, mirror] of [['hipL', 'kneeL', 'footL', true], ['hipR', 'kneeR', 'footR', false]] as const) {
    const bent = kneeBend(sk[hip], sk[knee], sk[foot]) > 0.35
    along(bent ? spr.legBend : spr.leg, sk[hip], sk[foot], limbW * (bent ? 1.25 : 1), mirror)
  }
  const shoulder = { x: (sk.shoulderL.x + sk.shoulderR.x) / 2, y: (sk.shoulderL.y + sk.shoulderR.y) / 2 }
  const hip = { x: (sk.hipL.x + sk.hipR.x) / 2, y: (sk.hipL.y + sk.hipR.y) / 2 }
  const torsoLen = Math.hypot(X(shoulder) - X(hip), Y(shoulder) - Y(hip))
  const bodyW = torsoLen * (spr.body.width / spr.body.height) * 1.1
  const neckTop = { x: shoulder.x + (shoulder.x - hip.x) * 0.12, y: shoulder.y + (shoulder.y - hip.y) * 0.12 }
  along(spr.body, neckTop, hip, bodyW, false, 0.05)
  for (const [sh, hand, mirror] of [['shoulderL', 'handL', false], ['shoulderR', 'handR', true]] as const) {
    along(spr.arm, sk[sh], sk[hand], limbW * 0.95, mirror, 0.05)
    const hs = H * 0.075
    ctx.drawImage(spr.hand, X(sk[hand]) - hs / 2, Y(sk[hand]) - hs / 2, hs, hs)
  }
  const headW = H * 0.3
  const headH = headW * (spr.head.height / spr.head.width)
  ctx.drawImage(spr.head, X(sk.head) - headW / 2, Y(sk.head) - headH * 0.62, headW, headH)
  ctx.globalAlpha = 1
}
