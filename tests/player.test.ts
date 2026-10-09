import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Player } from '../src/audio/player'

/** Minimal stand-in for the Web Audio API, enough to drive Player. */
class FakeContext {
  static instances = 0
  static resumeWorks = true
  state: AudioContextState = 'suspended'
  currentTime = 0
  outputLatency = 0
  baseLatency = 0
  destination = {}
  onstatechange: (() => void) | null = null
  started: number[] = []
  constructor() {
    FakeContext.instances++
  }
  async resume() {
    if (FakeContext.resumeWorks) this.state = 'running'
  }
  createBufferSource() {
    const started = this.started
    return {
      buffer: null as unknown,
      onended: null as unknown,
      connect() {},
      disconnect() {},
      start(_when: number, offset: number) {
        started.push(offset)
      },
      stop() {},
    }
  }
}

const buffer = { duration: 10 } as AudioBuffer

describe('Player', () => {
  beforeEach(() => {
    FakeContext.instances = 0
    FakeContext.resumeWorks = true
    vi.stubGlobal('AudioContext', FakeContext)
  })

  it('creates no AudioContext until it is first used', () => {
    const p = new Player()
    expect(FakeContext.instances).toBe(0)
    expect(p.audioState).toBe('none')
    void p.ctx
    expect(FakeContext.instances).toBe(1)
  })

  it('plays: resumes the context and starts a source at the offset', async () => {
    const p = new Player()
    p.load(buffer)
    p.seek(3)
    await p.play()
    expect(p.playing).toBe(true)
    expect(p.error).toBeNull()
    expect((p.ctx as unknown as FakeContext).started).toEqual([3])
  })

  it('reports an error instead of failing silently when nothing is loaded', async () => {
    const p = new Player()
    await p.play()
    expect(p.playing).toBe(false)
    expect(p.error).toMatch(/No audio/)
  })

  it('reports an error when the browser keeps audio blocked', async () => {
    FakeContext.resumeWorks = false
    const p = new Player()
    p.load(buffer)
    await p.play()
    expect(p.playing).toBe(false)
    expect(p.error).toMatch(/blocked/)
  })

  it('ignores a second play() while the first is still starting', async () => {
    const p = new Player()
    p.load(buffer)
    await Promise.all([p.play(), p.play()])
    expect((p.ctx as unknown as FakeContext).started).toHaveLength(1)
  })

  it('getPlayer returns the same Player across module reloads', async () => {
    const a = (await import('../src/audio/shared')).getPlayer()
    vi.resetModules()
    const b = (await import('../src/audio/shared')).getPlayer()
    expect(b).toBe(a)
  })
})
