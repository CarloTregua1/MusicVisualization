import { encodeWav } from './wav'

type Listener = () => void

/** Sample rate used for decoding; analysis works on this rate whatever the file's. */
const DECODE_RATE = 44100

/**
 * Play/pause/seek for the loaded track. Playback goes through a plain
 * HTMLAudioElement — the same path the browser uses for any web video — so
 * it is not subject to Web Audio's autoplay and output-device quirks
 * (Safari especially). Web Audio is used only offline, to decode the file
 * for analysis. An alternate track (the resynthesized "math" version) can
 * be swapped in at the same position for A/B listening.
 */
export class Player {
  private element: HTMLAudioElement | null = null
  private decoder: OfflineAudioContext | null = null
  private originalUrl: string | null = null
  private alternateUrl: string | null = null
  private useAlternate = false
  private trackDuration = 0
  private listeners = new Set<Listener>()
  // Last media time seen and when, to interpolate between coarse clock updates.
  private lastMedia = -1
  private lastPerf = 0
  /** Why the last play() failed, for the UI; null when fine. */
  error: string | null = null

  /** Offline context for decoding audio and creating buffers; never makes sound. */
  get ctx(): BaseAudioContext {
    return (this.decoder ??= new OfflineAudioContext(1, DECODE_RATE, DECODE_RATE))
  }

  private get audio(): HTMLAudioElement {
    if (!this.element) {
      const el = document.createElement('audio')
      el.preload = 'auto'
      // Changing src pauses the element without a 'pause' event; 'emptied' covers it.
      for (const ev of ['play', 'playing', 'pause', 'ended', 'emptied', 'seeked']) el.addEventListener(ev, () => this.sync())
      el.addEventListener('error', () => {
        if (el.getAttribute('src')) this.fail("The browser couldn't play this audio.")
      })
      this.element = el
    }
    return this.element
  }

  /** Read from the element itself, so it can never disagree with what is audible. */
  get playing(): boolean {
    const el = this.element
    return !!el && !el.paused && !el.ended
  }

  get duration(): number {
    return this.trackDuration
  }

  get abState(): 'original' | 'math' {
    return this.useAlternate && this.alternateUrl ? 'math' : 'original'
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private sync() {
    this.lastMedia = -1
    this.emit()
  }

  private fail(message: string) {
    this.error = message
    this.emit()
  }

  /** Loads a track: `file` is played, `buffer` (its decoded audio) gives the duration. */
  load(buffer: AudioBuffer, file: Blob) {
    const el = this.audio
    el.pause()
    if (this.originalUrl) URL.revokeObjectURL(this.originalUrl)
    if (this.alternateUrl) URL.revokeObjectURL(this.alternateUrl)
    this.originalUrl = URL.createObjectURL(file)
    this.alternateUrl = null
    this.useAlternate = false
    this.trackDuration = buffer.duration
    this.error = null
    el.src = this.originalUrl
    el.currentTime = 0
    this.sync()
  }

  /** Playback position in seconds. */
  position(): number {
    if (!this.element) return 0
    const t = this.element.currentTime
    if (!this.playing) return t
    // Some browsers update currentTime coarsely; extrapolate between updates.
    const now = performance.now()
    if (t !== this.lastMedia) {
      this.lastMedia = t
      this.lastPerf = now
      return t
    }
    return Math.min(this.trackDuration, t + (now - this.lastPerf) / 1000)
  }

  /** Position of what is audible right now (for the visuals). */
  currentTime(): number {
    return this.position()
  }

  async play() {
    if (this.playing) return
    if (!this.originalUrl) {
      this.fail('No audio is loaded. Open a file first.')
      return
    }
    const el = this.audio
    if (el.ended || el.currentTime >= this.trackDuration) el.currentTime = 0
    try {
      await el.play()
      this.error = null
      this.emit()
    } catch (e) {
      const name = (e as DOMException)?.name
      this.fail(
        name === 'NotAllowedError'
          ? 'The browser blocked audio. Click anywhere on the page, then press play again.'
          : "The browser couldn't play this audio.",
      )
    }
  }

  pause() {
    this.element?.pause()
  }

  toggle() {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(seconds: number) {
    if (!this.element) return
    this.element.currentTime = Math.max(0, Math.min(seconds, this.trackDuration))
    this.lastMedia = -1
    this.emit()
  }

  /** Sets (or clears) the alternate "math" track, from its rendered samples. */
  setAlternate(buffer: AudioBuffer | null) {
    if (this.alternateUrl) URL.revokeObjectURL(this.alternateUrl)
    this.alternateUrl = buffer ? URL.createObjectURL(encodeWav(buffer.getChannelData(0), buffer.sampleRate)) : null
    if (!buffer) this.setAB('original')
    else this.emit()
  }

  setAB(which: 'original' | 'math') {
    const useAlt = which === 'math' && this.alternateUrl !== null
    if (useAlt === this.useAlternate || !this.originalUrl) return
    this.useAlternate = useAlt
    const el = this.audio
    const t = el.currentTime
    const wasPlaying = this.playing
    el.src = (useAlt ? this.alternateUrl : this.originalUrl) as string
    // A position set before the new source's metadata loads can be dropped
    // (Safari resets to 0), so restore it once the track is ready.
    el.addEventListener(
      'loadedmetadata',
      () => {
        el.currentTime = t
        if (wasPlaying) void this.play()
        else this.emit()
      },
      { once: true },
    )
  }

  /** Engine state for diagnostics. */
  get audioState(): string {
    if (!this.element) return 'none'
    return this.playing ? 'playing' : 'paused'
  }
}
