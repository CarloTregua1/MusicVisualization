/** Everything that defines how the tubes feel, tunable live from the Visualizer. */
export interface TunnelParams {
  /**
   * Tube timing. false: a fixed number of tubes per second. true: follow the
   * song — a new tube is born on each sound event (hit, note, change), and
   * the white rim keeps developing until the next one.
   */
  followSong: boolean
  /**
   * Direction of travel. false (outward): tubes develop as the white crater
   * rim and spread out across the land. true (inward): tubes are born at the
   * edge of the land, travel in, turn white as the innermost tube and sink
   * into the crater.
   */
  inward: boolean
  /** In follow-the-song mode, how small an event can start a new tube (0 = only big hits, 1 = every small change). */
  songSensitivity: number
  /** Tubes born per second in fixed-rate mode (each develops as the white rim for 1/rate s). */
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
  /** How much walls curl outward as they rise (radial lean per unit of height). */
  curl: number
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
  /** Soft contact shadow under each tube, darkening what lies behind it. */
  shadow: number
  /** Strength of the glints where a tube reflects the rim's light toward the camera. */
  specular: number
  /** Glow along tube edges seen against the light. */
  edgeGlow: number
  /** Cool fill light from the camera's side, so distant tubes keep their form. */
  fill: number
  /** Colour from frequency (0 = age ramp only, 1 = fully by frequency). */
  colourVariety: number
  /** Random moments per minute when the light cuts out while music plays (0 = never). */
  blackoutsPerMinute: number
  /** Average length of a blackout, seconds. */
  blackoutLength: number
  /** Show the dancer in the crater. */
  dancerOn: boolean
  /** Dancer height relative to the crater's width on screen. */
  dancerSize: number
  /** How strongly the dancer moves with the music's energy. */
  dancerEnergy: number
  /** Dancer limb thickness relative to its height. */
  dancerThickness: number
  /** Light-painting trails from the dancer's hands and feet, 0..1. */
  dancerTrails: number
  /** Fading echoes of the dancer a quarter and half beat behind, 0..1. */
  dancerEchoes: number
  /** The dancer's reflection on the crater floor, 0..1. */
  dancerReflection: number
  /** Stomps send ripples through the tubes, 0..1. */
  stompRipples: number
  /** A raised hand pulls up a wall in the forming tubes, 0..1. */
  handWalls: number
  /** Energetic dancing adds to the white rim's light, 0..1. */
  dancerLight: number
  /** Strength of the glow (bloom). */
  bloom: number
  /** Strength of the motion trail. */
  trail: number
}

/** Starting point measured from the reference video's frames. */
export const MEASURED_PARAMS: TunnelParams = {
  followSong: false,
  inward: false,
  songSensitivity: 0.6,
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
  curl: 0.25,
  coherence: 0.06,
  cameraAngle: 45,
  cameraRange: 10,
  focal: 2.1,
  lightFalloff: 3.2,
  shadow: 0.45,
  specular: 0.8,
  edgeGlow: 0.5,
  fill: 0.12,
  colourVariety: 0.6,
  blackoutsPerMinute: 4,
  blackoutLength: 0.7,
  dancerOn: true,
  dancerSize: 0.6,
  dancerEnergy: 1,
  dancerThickness: 0.035,
  dancerTrails: 0.6,
  dancerEchoes: 0.5,
  dancerReflection: 0.5,
  stompRipples: 0.7,
  handWalls: 0.7,
  dancerLight: 0.5,
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

/** Numeric parameters, the ones that get sliders. */
export type NumericParam = { [K in keyof TunnelParams]: TunnelParams[K] extends number ? K : never }[keyof TunnelParams]

export interface ParamSpec {
  key: NumericParam
  label: string
  group: string
  min: number
  max: number
  step: number
}

export const PARAM_SPECS: ParamSpec[] = [
  { key: 'songSensitivity', label: 'Song sensitivity', group: 'Flow', min: 0, max: 1, step: 0.05 },
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
  { key: 'curl', label: 'Wall curl', group: 'Shape', min: -0.5, max: 1, step: 0.05 },
  { key: 'cameraAngle', label: 'Camera angle (°)', group: 'Camera', min: 5, max: 85, step: 1 },
  { key: 'cameraRange', label: 'Camera distance', group: 'Camera', min: 4, max: 20, step: 0.1 },
  { key: 'focal', label: 'Zoom', group: 'Camera', min: 0.8, max: 4, step: 0.05 },
  { key: 'lightFalloff', label: 'Light reach', group: 'Light', min: 0.5, max: 10, step: 0.1 },
  { key: 'shadow', label: 'Contact shadow', group: 'Light', min: 0, max: 1, step: 0.05 },
  { key: 'specular', label: 'Glints', group: 'Light', min: 0, max: 2, step: 0.05 },
  { key: 'edgeGlow', label: 'Edge glow', group: 'Light', min: 0, max: 1.5, step: 0.05 },
  { key: 'fill', label: 'Fill light', group: 'Light', min: 0, max: 0.6, step: 0.01 },
  { key: 'bloom', label: 'Glow', group: 'Light', min: 0, max: 1.5, step: 0.05 },
  { key: 'blackoutsPerMinute', label: 'Blackouts per minute', group: 'Light', min: 0, max: 20, step: 0.5 },
  { key: 'blackoutLength', label: 'Blackout length (s)', group: 'Light', min: 0.1, max: 3, step: 0.05 },
  { key: 'colourVariety', label: 'Colour variety', group: 'Colour', min: 0, max: 1, step: 0.05 },
  { key: 'dancerSize', label: 'Size', group: 'Dancer', min: 0.2, max: 1.2, step: 0.05 },
  { key: 'dancerEnergy', label: 'Energy', group: 'Dancer', min: 0, max: 2, step: 0.05 },
  { key: 'dancerThickness', label: 'Thickness', group: 'Dancer', min: 0.01, max: 0.08, step: 0.005 },
  { key: 'dancerTrails', label: 'Light trails', group: 'Dancer', min: 0, max: 1, step: 0.05 },
  { key: 'dancerEchoes', label: 'Echoes', group: 'Dancer', min: 0, max: 1, step: 0.05 },
  { key: 'dancerReflection', label: 'Reflection', group: 'Dancer', min: 0, max: 1, step: 0.05 },
  { key: 'stompRipples', label: 'Stomp ripples', group: 'Dancer ↔ tubes', min: 0, max: 1.5, step: 0.05 },
  { key: 'handWalls', label: 'Hand walls', group: 'Dancer ↔ tubes', min: 0, max: 1.5, step: 0.05 },
  { key: 'dancerLight', label: 'Dancer light', group: 'Dancer ↔ tubes', min: 0, max: 1, step: 0.05 },
  { key: 'trail', label: 'Trail', group: 'Light', min: 0, max: 0.8, step: 0.01 },
]
