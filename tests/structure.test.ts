import { describe, expect, it } from 'vitest'
import { trackBeats } from '../src/dsp/beats'
import { findDownbeat, findDrops } from '../src/dsp/structure'
import { analyzeTempo, runToEnd } from '../src/dsp/tempo'

const SR = 44100

/** 120 BPM kicks; the bar's first beat is louder; optional quiet section before `dropAt` seconds. */
function song(seconds: number, firstAccented: number, dropAt?: number) {
  const x = new Float32Array(seconds * SR)
  let rand = 3
  const noise = () => ((rand = (rand * 16807) % 2147483647) / 2147483647) * 2 - 1
  let beat = 0
  for (let t = 0.25; t < seconds - 0.1; t += 0.5, beat++) {
    const quiet = dropAt !== undefined && t < dropAt
    const amp = (beat % 4 === firstAccented ? 0.9 : 0.35) * (quiet ? 0.12 : 1)
    const s = Math.round(t * SR)
    for (let i = 0; i < 0.08 * SR && s + i < x.length; i++)
      x[s + i] += amp * Math.exp(-i / (0.015 * SR)) * (0.5 * noise() + Math.sin((2 * Math.PI * 55 * i) / SR))
  }
  // A pad that is quiet before the drop and full after it.
  for (let n = 0; n < x.length; n++) {
    const t = n / SR
    x[n] += (dropAt !== undefined && t < dropAt ? 0.01 : 0.12) * Math.sin(2 * Math.PI * 220 * t)
  }
  return x
}

function structure(x: Float32Array) {
  const tempo = runToEnd(analyzeTempo(x, SR))
  const beats = runToEnd(trackBeats(tempo))
  return { tempo, beats }
}

describe('song structure', () => {
  for (const accented of [0, 1, 2, 3]) {
    it(`finds the downbeat when beat ${accented} of the grid starts the bar`, () => {
      const x = song(20, accented)
      const { tempo, beats } = structure(x)
      // The accented clicks are at 0.25 + 0.5·k with k ≡ accented (mod 4).
      const offset = findDownbeat(beats, tempo)
      const t = beats[offset]
      const k = Math.round((t - 0.25) / 0.5)
      expect(((k % 4) + 4) % 4).toBe(accented)
    })
  }

  it('finds a drop where the music bursts out after a quiet build', () => {
    const x = song(30, 0, 14)
    const { beats } = structure(x)
    const drops = findDrops(x, SR, beats)
    expect(drops.length).toBe(1)
    expect(Math.abs(drops[0] - 14)).toBeLessThan(0.6)
  })

  it('finds no drop in music that stays the same', () => {
    const x = song(30, 0)
    const { beats } = structure(x)
    expect(findDrops(x, SR, beats).length).toBe(0)
  })
})
