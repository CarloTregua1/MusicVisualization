type Listener = () => void

/**
 * Play/pause/seek over an AudioBuffer. Web Audio sources are one-shot, so
 * each play() creates a new AudioBufferSourceNode starting at `offset`.
 * An optional alternate buffer (the resynthesized "math" version) can be
 * swapped in at the same position for A/B listening.
 */
export class Player {
  private context: AudioContext | null = null
  private original: AudioBuffer | null = null
  private alternate: AudioBuffer | null = null
  private useAlternate = false
  private source: AudioBufferSourceNode | null = null
  private startTime = 0
  private offset = 0
  private listeners = new Set<Listener>()
  /** True between a play() call and the source actually starting. */
  private starting = false
  playing = false
  /** Why the last play() failed, for the UI; null when fine. */
  error: string | null = null

  /**
   * The AudioContext, created on first use. That first use is a user gesture
   * (loading a file or pressing play), which Safari needs to allow sound.
   */
  get ctx(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext()
      // Safari can suspend or "interrupt" the context; reflect that in the UI.
      this.context.onstatechange = () => this.emit()
    }
    return this.context
  }

  /** Audio engine state for the UI: 'none' before the first gesture. */
  get audioState(): string {
    return this.context?.state ?? 'none'
  }

  /** Call from any user gesture: wakes a context the browser suspended while playing. */
  unlock() {
    const ctx = this.context
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {})
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
    if (this.playing || this.starting) return
    if (!this.original) {
      this.fail('No audio is loaded. Open a file first.')
      return
    }
    if (this.offset >= this.duration) this.offset = 0
    this.starting = true
    try {
      await this.ctx.resume()
    } catch {
      /* state is checked below */
    } finally {
      this.starting = false
    }
    if (this.ctx.state !== 'running') {
      this.fail('The browser blocked audio. Click anywhere on the page, then press play again.')
      return
    }
    this.error = null
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

  private fail(message: string) {
    this.error = message
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
