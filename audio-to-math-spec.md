# Project Spec: Audio → Math (Live Fourier Expression Visualizer)

## Goal
Build a web app that takes an audio file as input and, **while the audio plays**, shows:
1. A **live mathematical expression** (sum of sinusoids) that approximates the current slice of audio.
2. A **graphical view** of that expression compared with the real waveform.
3. An **epicycles view**, where each term is drawn as a rotating circle.

The expression is **time-varying**. It is recomputed for each analysis frame (~20–50 ms), because one global formula for a whole track would be impractically large.

---

## Tech Stack
- **Vite + React + TypeScript**
- **Web Audio API** for decoding, playback and timing (`AudioContext`, `AudioBufferSourceNode`)
- **FFT:** `fft.js` (or a small custom radix-2 FFT). It must return complex output so phase is available.
- **KaTeX** to render the formula
- **Canvas 2D** for the waveform, reconstruction and epicycles. Switch to WebGL only if performance requires it.
- **Vitest** for unit tests of the DSP code
- No backend. Everything runs client-side.

---

## Core Math

For an analysis window centered at time `t₀`, the signal is approximated as:

```
x(t) ≈ Σ_{k=1..N} A_k · sin(2π · f_k · (t − t₀) + φ_k)
```

Pipeline per frame:
1. Take a window of `W` samples (default 2048, configurable 1024 to 8192) from the decoded `AudioBuffer`. Mix stereo to mono.
2. Apply a **Hann window**.
3. Run the FFT, then compute the magnitude and phase per bin.
4. **Peak picking:** find local maxima above a noise floor, then keep the top `N` peaks by magnitude (N is user-controlled, 1 to 64, default 10).
5. **Frequency refinement:** use parabolic interpolation on the log-magnitude around each peak to get sub-bin frequency accuracy.
6. **Amplitude correction:** compensate for the Hann window gain (×2 / sum of window).
7. Output a list of `{ freq, amp, phase }` sorted by amplitude.

Optional temporal smoothing: match peaks across frames by nearest frequency and apply an EMA on amplitude to reduce flicker. Make it toggleable.

---

## Features

### MVP
- [ ] Drag & drop or file picker for audio (mp3, wav, ogg, flac, whatever the browser can decode)
- [ ] Play / pause / seek, with a timeline scrubber
- [ ] Analysis synced to the playback position (`audioContext.currentTime − startTime + offset`), inside a `requestAnimationFrame` loop
- [ ] **Formula panel:** KaTeX-rendered expression with the top N terms
  - Frequencies in Hz, rounded to 1 decimal
  - Amplitudes to 3 decimals
  - Phases in radians to 2 decimals
  - Throttle LaTeX re-rendering to ~15 fps for readability (the visuals still run at 60 fps)
- [ ] **Waveform panel:** real audio window (one color) overlaid with the N-term reconstruction (another color), plus the RMS error shown as a number
- [ ] **Slider for N** (number of terms), with live update
- [ ] **Window size** selector

### Phase 2
- [ ] **Epicycles view:** circles chained tip to tail, with radius = amplitude, angular speed = 2πf, initial angle = phase. Trace the resulting curve. Use a time-scale slider, because real audio frequencies are too fast to see, so playback in this view is slowed (e.g. 1/500×).
- [ ] **Spectrum panel:** FFT magnitude bar chart with the chosen peaks highlighted
- [ ] **Note names:** show the closest musical note next to each frequency (A4 = 440 Hz)
- [ ] **"Hear the math" mode:** resynthesize audio from only the N-term expression (oscillator bank or overlap-add of per-frame sinusoids) and A/B toggle against the original

### Phase 3
- [ ] Export the current frame's formula as LaTeX or plain text (copy button)
- [ ] Export all frames as JSON: `[{ time, terms: [{freq, amp, phase}] }]`
- [ ] Export a video or GIF of the visualization (stretch goal)

---

## Project Structure
```
src/
  audio/
    loader.ts          # file → AudioBuffer
    player.ts          # play/pause/seek, current time
  dsp/
    window.ts          # Hann window
    fft.ts             # FFT wrapper (complex output)
    peaks.ts           # peak picking + parabolic interpolation
    analyze.ts         # frame → Term[]
    resynth.ts         # Term[] → samples (phase 2)
    smoothing.ts       # cross-frame peak tracking (optional)
  render/
    formula.ts         # Term[] → LaTeX string
    waveformCanvas.ts
    epicyclesCanvas.ts
    spectrumCanvas.ts
  components/
    DropZone.tsx
    Transport.tsx
    FormulaPanel.tsx
    WaveformPanel.tsx
    EpicyclesPanel.tsx
    Controls.tsx
  App.tsx
  types.ts             # Term { freq: number; amp: number; phase: number }
tests/
  dsp.test.ts
```

---

## Acceptance Tests (DSP)
Write these in Vitest **before** the UI:
- A pure sine at 440 Hz with amp 0.5 → top term freq within ±1 Hz, amp within ±5%
- Sum of 220 Hz + 660 Hz (amps 0.6 / 0.3) → both detected, in the correct order
- Phase test: `sin(2π·100·t + 1.0)` → recovered phase within ±0.1 rad, given a consistent time reference at the window center
- Reconstruction of a 3-tone signal with N=3 → RMS error < 2% of signal RMS
- Silence → returns an empty term list (noise floor respected)

---

## UX / Design
- Dark theme, full-screen "instrument" feel
- Layout: formula on top (large, centered), waveform in the middle, epicycles or spectrum below. Single column on mobile.
- Each term gets a consistent color across the formula, the epicycle circle and the spectrum peak
- Smooth 60 fps visuals. Never block the main thread for more than 8 ms per frame. If analysis is too slow, move the DSP to a **Web Worker**.

---

## Performance Notes
- Precompute the Hann window once per window size
- Reuse FFT instances and typed arrays (no allocations in the render loop)
- For long files, analysis runs on demand at the current playhead, so no pre-analysis of the whole track is needed for the MVP

---

## Development Order
1. Scaffold Vite + React + TS, and add KaTeX, fft.js and Vitest
2. Implement `dsp/*` and make all acceptance tests pass
3. Audio loading and the playback transport
4. rAF loop, analysis at the playhead, formula panel
5. Waveform overlay and RMS error
6. Controls (N, window size)
7. Phase 2 features, then Phase 3

Commit after each step. Keep the DSP pure and framework-free, so it is testable in isolation.
