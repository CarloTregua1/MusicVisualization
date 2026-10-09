import { describe, expect, it } from 'vitest'
import { MAX_COLOUR_LIGHTNESS, tubeColor } from '../src/render/tubeColor'

const parse = (c: string) => {
  const m = /hsl\((\d+), (\d+)%, (\d+)%\)/.exec(c)
  if (!m) throw new Error(c)
  return { h: +m[1], s: +m[2], l: +m[3] }
}

describe('tubeColor', () => {
  it('never lets a non-innermost tube look white, however brightly lit', () => {
    for (const light of [0, 0.5, 1, 1.6, 3, 10])
      for (const depth of [0, 0.3, 1])
        for (const temperature of [0, 0.5, 1]) {
          const { s, l } = parse(tubeColor(temperature, depth, 0.5, 0, light, 0))
          expect(l).toBeLessThanOrEqual(MAX_COLOUR_LIGHTNESS)
          expect(s).toBe(100)
        }
  })

  it('lets the innermost tube burn white', () => {
    const { s, l } = parse(tubeColor(0.5, 0, 0.5, 0, 1, 1))
    expect(l).toBeGreaterThan(90)
    expect(s).toBeLessThan(30)
  })
})
