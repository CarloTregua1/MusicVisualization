import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FiberTunnel as Tunnel } from '../src/render/fiberTunnel'

let FiberTunnel: typeof Tunnel

beforeAll(async () => {
  // The tunnel only needs canvases to exist; nothing is drawn in these tests.
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) })
  ;({ FiberTunnel } = await import('../src/render/fiberTunnel'))
})

const DT = 1 / 60
const input = { bands: new Float32Array(48).fill(0.5), level: 0.6, temperature: 0.5 }
const count = (t: Tunnel) => (t as unknown as { count: number }).count

/** Runs `seconds` of playback, firing a song event at the given frame numbers. */
function run(t: Tunnel, seconds: number, events: Set<number> = new Set()) {
  for (let f = 0; f < seconds / DT; f++) t.update(DT, input, true, 0, 30, events.has(f))
}

describe('tube timing', () => {
  it('fixed rate: tubes per second, regardless of the song', () => {
    const t = new FiberTunnel(48)
    t.params = { ...t.params, followSong: false, tubesPerSecond: 12 }
    run(t, 2)
    expect(count(t)).toBeGreaterThanOrEqual(23)
    expect(count(t)).toBeLessThanOrEqual(25)
  })

  it('follow the song: a tube is born only on song events', () => {
    const t = new FiberTunnel(48)
    t.params = { ...t.params, followSong: true }
    run(t, 2) // no events: only the first tube, still developing at the rim
    expect(count(t)).toBe(1)
    const t2 = new FiberTunnel(48)
    t2.params = { ...t2.params, followSong: true }
    run(t2, 2, new Set([10, 30, 31, 70, 100]))
    expect(count(t2)).toBe(6) // the first tube + one per event
  })

  it('follow the song: the white rim stays at the crater until the next event', () => {
    const t = new FiberTunnel(48)
    t.params = { ...t.params, followSong: true }
    run(t, 1)
    const rim = (t as unknown as { tube: (i: number) => { radius: number } }).tube(0)
    expect(rim.radius).toBe(1)
  })
})
