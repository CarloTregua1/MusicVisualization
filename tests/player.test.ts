import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Player } from '../src/audio/player'
import { encodeWav } from '../src/audio/wav'

/** Minimal stand-in for HTMLAudioElement, enough to drive Player. */
class FakeAudio {
  static allowPlay = true
  static created = 0
  src = ''
  currentTime = 0
  paused = true
  ended = false
  preload = ''
  private handlers = new Map<string, Array<{ fn: () => void; once: boolean }>>()
  constructor() {
    FakeAudio.created++
  }
  getAttribute(name: string) {
    return name === 'src' ? this.src : null
  }
  addEventListener(type: string, fn: () => void, opts?: { once?: boolean }) {
    const list = this.handlers.get(type) ?? []
    list.push({ fn, once: !!opts?.once })
    this.handlers.set(type, list)
  }
  fire(type: string) {
    const list = this.handlers.get(type) ?? []
    this.handlers.set(type, list.filter((h) => !h.once))
    for (const h of list) h.fn()
  }
  async play() {
    if (!FakeAudio.allowPlay) throw new DOMException('blocked', 'NotAllowedError')
    this.paused = false
    this.fire('play')
  }
  pause() {
    if (this.paused) return
    this.paused = true
    this.fire('pause')
  }
}

const buffer = { duration: 10 } as AudioBuffer
const file = new Blob(['x'])
let audios: FakeAudio[] = []

describe('Player', () => {
  beforeEach(() => {
    FakeAudio.allowPlay = true
    FakeAudio.created = 0
    audios = []
    vi.stubGlobal('document', {
      createElement: () => {
        const a = new FakeAudio()
        audios.push(a)
        return a
      },
    })
    let n = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++n}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('plays through a media element from the loaded file', async () => {
    const p = new Player()
    p.load(buffer, file)
    p.seek(3)
    await p.play()
    expect(p.playing).toBe(true)
    expect(p.error).toBeNull()
    expect(audios).toHaveLength(1)
    expect(audios[0].src).toBe('blob:1')
    expect(audios[0].currentTime).toBe(3)
  })

  it('pauses and reports position from the element', async () => {
    const p = new Player()
    p.load(buffer, file)
    await p.play()
    audios[0].currentTime = 4.5
    p.pause()
    expect(p.playing).toBe(false)
    expect(p.position()).toBe(4.5)
  })

  it('reports an error instead of failing silently when nothing is loaded', async () => {
    const p = new Player()
    await p.play()
    expect(p.playing).toBe(false)
    expect(p.error).toMatch(/No audio/)
  })

  it('reports an error when the browser blocks playback', async () => {
    FakeAudio.allowPlay = false
    const p = new Player()
    p.load(buffer, file)
    await p.play()
    expect(p.playing).toBe(false)
    expect(p.error).toMatch(/blocked/)
  })

  it('A/B switch keeps the position once the new source is ready', async () => {
    const p = new Player()
    p.load(buffer, file)
    p.setAlternate({ getChannelData: () => new Float32Array(4), sampleRate: 8000 } as unknown as AudioBuffer)
    await p.play()
    audios[0].currentTime = 6
    p.setAB('math')
    expect(audios[0].src).toBe('blob:2')
    // What browsers do on a source change: pause silently, reset the clock.
    audios[0].paused = true
    audios[0].currentTime = 0
    expect(p.playing).toBe(false)
    audios[0].fire('loadedmetadata')
    await Promise.resolve()
    expect(audios[0].currentTime).toBe(6)
    expect(p.abState).toBe('math')
    // It must resume playing on the new source, not just think it is playing.
    expect(audios[0].paused).toBe(false)
    expect(p.playing).toBe(true)
  })

  it('getPlayer returns the same Player across module reloads', async () => {
    const a = (await import('../src/audio/shared')).getPlayer()
    vi.resetModules()
    const b = (await import('../src/audio/shared')).getPlayer()
    expect(b).toBe(a)
  })
})

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM header and samples', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 0.5]), 22050)
    const v = new DataView(await blob.arrayBuffer())
    const text = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)))
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(v.getUint32(24, true)).toBe(22050)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16383])
  })
})
