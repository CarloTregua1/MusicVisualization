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

/** Stars of the constellation head: fixed positions in a unit disc (denser at the centre), sizes, twinkle phases. */
const HEAD_STARS = (() => {
  let seed = 4242
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const stars = Array.from({ length: 30 }, (_, i) => {
    const r = i === 0 ? 0 : Math.pow(rnd(), 0.7)
    const a = rnd() * Math.PI * 2
    return { x: r * Math.cos(a), y: r * Math.sin(a), size: 0.45 + rnd() * (i < 4 ? 1.1 : 0.7), phase: rnd() * Math.PI * 2, speed: 1.5 + rnd() * 3, drift: rnd() * Math.PI * 2 }
  })
  return { stars }
})()

/**
 * A glowing star: a faint wide halo, a softer middle and a bright core —
 * three plain circles (much cheaper than a gradient per star, per frame).
 */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inner: string, outer: string, alpha: number) {
  ctx.fillStyle = outer
  ctx.globalAlpha = 0.12 * alpha
  ctx.beginPath()
  ctx.arc(x, y, r * 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.35 * alpha
  ctx.beginPath()
  ctx.arc(x, y, r * 1.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = inner
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(x, y, r * 0.75, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Constellation: loose stars at the joints, and a
 * head made of a cloud of stars — a small swirling star map that rotates,
 * twinkles and swells on the beat.
 */
function paintConstellation(c: SkinContext) {
  const { ctx, sk, X, Y, colour, light, time } = c
  const alpha = Math.min(1, c.sceneLight)
  // How much brighter than the scene light the beat makes it (≥ 1 on a flash).
  const beat = Math.max(0, light / Math.max(0.01, c.sceneLight) - 1)

  // The head cloud: a tall oval of stars sitting on the neck, raised along
  // the neck's direction so it clears the shoulders.
  const rx = HEAD_RADIUS * c.H * 1.35 * (1 + 0.12 * beat)
  const ry = rx * 1.25
  let dx = X(sk.head) - X(sk.neck)
  let dy = Y(sk.head) - Y(sk.neck)
  const dl = Math.hypot(dx, dy) || 1
  dx /= dl
  dy /= dl
  const hx = X(sk.head) + dx * ry * 0.55
  const hy = Y(sk.head) + dy * ry * 0.55
  const rot = time * 0.35
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  const pts = HEAD_STARS.stars.map((st) => {
    const wob = 0.07
    const x0 = st.x + wob * Math.sin(time * 0.9 + st.drift)
    const y0 = st.y + wob * Math.cos(time * 0.7 + st.drift)
    return { x: hx + (x0 * cr - y0 * sr) * rx, y: hy + (x0 * sr + y0 * cr) * ry }
  })

  // A patch of night sky behind the head, so the star cloud reads against
  // the bright tubes beyond it.
  {
    const g = ctx.createRadialGradient(hx, hy, rx * 0.4, hx, hy, rx * 2.4)
    g.addColorStop(0, 'rgba(2,2,6,0.9)')
    g.addColorStop(1, 'rgba(2,2,6,0)')
    ctx.globalAlpha = alpha
    ctx.fillStyle = g
    ctx.fillRect(hx - rx * 2.4, hy - rx * 2.4, rx * 4.8, rx * 4.8)
  }
  ctx.globalCompositeOperation = 'lighter'
  // Faint nebula behind the head.
  {
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, rx * 1.5)
    g.addColorStop(0, colour(light * 0.9))
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = 0.22 * alpha
    ctx.fillStyle = g
    ctx.fillRect(hx - rx * 1.5, hy - rx * 1.5, rx * 3, rx * 3)
  }

  // Body stars at the joints.
  for (const name of Object.keys(sk) as (keyof Skeleton)[]) {
    if (name === 'head') continue
    const big = name.startsWith('hand') || name.startsWith('foot')
    const r = c.H * (big ? 0.036 : 0.024)
    star(ctx, X(sk[name]), Y(sk[name]), r, colour(light * 1.3), colour(light * 1.1), alpha)
  }

  // Head stars, each twinkling at its own pace.
  HEAD_STARS.stars.forEach((st, i) => {
    const tw = 0.55 + 0.45 * Math.sin(time * st.speed + st.phase)
    const r = c.H * 0.013 * st.size * (0.75 + 0.35 * tw) * (1 + 0.25 * beat)
    star(ctx, pts[i].x, pts[i].y, r, colour(light * (1.1 + 0.3 * tw)), colour(light * 0.9), alpha * (0.6 + 0.4 * tw))
  })

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
