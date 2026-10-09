export const WINDOW_SIZES = [1024, 2048, 4096, 8192] as const

export interface Settings {
  n: number
  size: number
  smoothing: boolean
  notes: boolean
  /** Epicycle playback rate relative to real time. */
  timeScale: number
}
