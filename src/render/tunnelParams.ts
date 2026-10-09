/** Everything that defines how the tubes feel, tunable live from the Visualizer. */
export interface TunnelParams {
  /** Tubes born per second (each develops as the white rim for 1/rate s). */
  tubesPerSecond: number
  /** Seconds a ring takes to spread from the rim to the edge of the land, at 120 BPM. */
  spreadSeconds: number
  /** Tube cross-section radius at the rim, in crater radii. */
  tubeRadius: number
  /** How much tubes thicken as they spread (exponent on the ring radius). */
  thicknessGrowth: number
  /** Overall height of waves and walls at the rim, in crater radii. */
  heightUnit: number
  /** Height of the tallest walls (spectral peaks), in height units. */
  wallHeight: number
  /** Height of the small waves, in height units. */
  waveHeight: number
  /** Crest sharpness: higher = narrower, more acute peaks over flat troughs. */
  crestSharpness: number
  /** Wave count around a ring for dull sound… */
  wavesMin: number
  /** …and for bright sound. */
  wavesMax: number
  /** Irregular lumps in each ring's outline, relative to its radius. */
  lump: number
  /** How much bass makes a ring breathe wider. */
  breath: number
  /** How much the bass/treble balance tilts a ring. */
  tilt: number
  /** Fine jagged spikes from noisy treble. */
  jag: number
  /** Smoothing (s) of the sound between consecutive tubes: higher = more coherent, lower = more varied. */
  coherence: number
  /** Camera angle looking down at the crater, degrees. */
  cameraAngle: number
  /** Camera distance from the crater's centre, in crater radii. */
  cameraRange: number
  /** Focal length as a multiple of the screen's shorter side (zoom). */
  focal: number
  /** Distance over which the rim's light falls off, in crater radii. */
  lightFalloff: number
  /** Strength of the glow (bloom). */
  bloom: number
  /** Strength of the motion trail. */
  trail: number
}

/** Starting point measured from the reference video's frames. */
export const MEASURED_PARAMS: TunnelParams = {
  tubesPerSecond: 30,
  spreadSeconds: 3.4,
  tubeRadius: 0.013,
  thicknessGrowth: 0.8,
  heightUnit: 0.55,
  wallHeight: 1.5,
  waveHeight: 0.5,
  crestSharpness: 3,
  wavesMin: 3,
  wavesMax: 16,
  lump: 0.1,
  breath: 0.06,
  tilt: 0.5,
  jag: 0.35,
  coherence: 0.06,
  cameraAngle: 45,
  cameraRange: 10,
  focal: 2.1,
  lightFalloff: 3.2,
  bloom: 0.6,
  trail: 0.1,
}

/** The look before measuring (11 tubes/s, slow spread). */
export const PREVIOUS_PARAMS: TunnelParams = {
  ...MEASURED_PARAMS,
  tubesPerSecond: 11,
  spreadSeconds: 11,
  thicknessGrowth: 0.45,
}

export const PRESETS: Record<string, TunnelParams> = {
  Measured: MEASURED_PARAMS,
  Previous: PREVIOUS_PARAMS,
}

export interface ParamSpec {
  key: keyof TunnelParams
  label: string
  group: string
  min: number
  max: number
  step: number
}

export const PARAM_SPECS: ParamSpec[] = [
  { key: 'tubesPerSecond', label: 'Tubes per second', group: 'Flow', min: 2, max: 40, step: 1 },
  { key: 'spreadSeconds', label: 'Spread time (s)', group: 'Flow', min: 1, max: 16, step: 0.1 },
  { key: 'coherence', label: 'Coherence (s)', group: 'Flow', min: 0.01, max: 0.4, step: 0.01 },
  { key: 'tubeRadius', label: 'Thickness', group: 'Tubes', min: 0.003, max: 0.04, step: 0.001 },
  { key: 'thicknessGrowth', label: 'Thickness growth', group: 'Tubes', min: 0, max: 1.5, step: 0.05 },
  { key: 'heightUnit', label: 'Overall height', group: 'Shape', min: 0.1, max: 2, step: 0.05 },
  { key: 'wallHeight', label: 'Walls', group: 'Shape', min: 0, max: 5, step: 0.1 },
  { key: 'waveHeight', label: 'Waves', group: 'Shape', min: 0, max: 2, step: 0.05 },
  { key: 'crestSharpness', label: 'Crest sharpness', group: 'Shape', min: 1, max: 8, step: 0.1 },
  { key: 'wavesMin', label: 'Waves (dull sound)', group: 'Shape', min: 1, max: 30, step: 1 },
  { key: 'wavesMax', label: 'Waves (bright sound)', group: 'Shape', min: 1, max: 40, step: 1 },
  { key: 'lump', label: 'Lumps', group: 'Shape', min: 0, max: 0.4, step: 0.01 },
  { key: 'breath', label: 'Bass breathing', group: 'Shape', min: 0, max: 0.3, step: 0.01 },
  { key: 'tilt', label: 'Tilt', group: 'Shape', min: 0, max: 2, step: 0.05 },
  { key: 'jag', label: 'Spikes', group: 'Shape', min: 0, max: 1.5, step: 0.05 },
  { key: 'cameraAngle', label: 'Camera angle (°)', group: 'Camera', min: 5, max: 85, step: 1 },
  { key: 'cameraRange', label: 'Camera distance', group: 'Camera', min: 4, max: 20, step: 0.1 },
  { key: 'focal', label: 'Zoom', group: 'Camera', min: 0.8, max: 4, step: 0.05 },
  { key: 'lightFalloff', label: 'Light reach', group: 'Light', min: 0.5, max: 10, step: 0.1 },
  { key: 'bloom', label: 'Glow', group: 'Light', min: 0, max: 1.5, step: 0.05 },
  { key: 'trail', label: 'Trail', group: 'Light', min: 0, max: 0.8, step: 0.01 },
]
