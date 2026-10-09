type Listener = () => void

/**
 * Play/pause/seek over an AudioBuffer. Web Audio sources are one-shot, so
 * each play() creates a new AudioBufferSourceNode starting at `offset`.
 * An optional alternate buffer (the resynthesized "math" version) can be
 * swapped in at the same position for A/B listening.
 */
export class Player {
  readonly ctx: AudioContext
  private original: AudioBuffer | null = null
  private alternate: AudioBuffer | null = null
  private useAlternate = false
  private source: AudioBufferSourceNode | null = null
  private startTime = 0
  private offset = 0
  private listeners = new Set<Listener>()
  playing = false

  constructor(ctx = new AudioContext()) {
    this.ctx = ctx
  }

  get duration(): number {
    return this.original?.duration ?? 0
  }

  get abState(): 'original' | 'math' {
    return this.useAlternate && this.alternate ? 'math' : 'original'
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  load(buffer: AudioBuffer) {
    this.stopSource()
    this.original = buffer
    this.alternate = null
    this.useAlternate = false
    this.offset = 0
    this.playing = false
    this.emit()
  }

  /** Playback position in seconds, used for transport state. */
  position(): number {
    if (!this.playing) return this.offset
    return Math.min(this.offset + this.ctx.currentTime - this.startTime, this.duration)
  }

  /** Position of what is audible right now: corrects for output latency so visuals line up. */
  currentTime(): number {
    if (!this.playing) return this.offset
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0
    return Math.max(this.offset, this.position() - latency)
  }

  async play() {
    if (!this.original || this.playing) return
    if (this.offset >= this.duration) this.offset = 0
    await this.ctx.resume()
    const src = this.ctx.createBufferSource()
    src.buffer = this.useAlternate && this.alternate ? this.alternate : this.original
    src.connect(this.ctx.destination)
    src.onended = () => {
      if (this.source !== src) return
      this.source = null
      this.offset = this.duration
      this.playing = false
      this.emit()
    }
    src.start(0, this.offset)
    this.source = src
    this.startTime = this.ctx.currentTime
    this.playing = true
    this.emit()
  }

  pause() {
    if (!this.playing) return
    this.offset = this.position()
    this.stopSource()
    this.playing = false
    this.emit()
  }

  toggle() {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(seconds: number) {
    const wasPlaying = this.playing
    if (wasPlaying) {
      this.stopSource()
      this.playing = false
    }
    this.offset = Math.max(0, Math.min(seconds, this.duration))
    if (wasPlaying) void this.play()
    else this.emit()
  }

  setAlternate(buffer: AudioBuffer | null) {
    this.alternate = buffer
    if (!buffer) this.setAB('original')
    else this.emit()
  }

  setAB(which: 'original' | 'math') {
    const useAlt = which === 'math' && this.alternate !== null
    if (useAlt === this.useAlternate) return
    this.useAlternate = useAlt
    if (this.playing) this.seek(this.position())
    else this.emit()
  }

  private stopSource() {
    const src = this.source
    this.source = null
    if (src) {
      src.onended = null
      try {
        src.stop()
      } catch {
        /* already stopped */
      }
      src.disconnect()
    }
  }
}
