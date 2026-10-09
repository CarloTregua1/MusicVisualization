export interface LoadedAudio {
  name: string
  buffer: AudioBuffer
  /** All channels averaged to mono, computed once at load time. */
  mono: Float32Array
  sampleRate: number
}

export async function loadAudioFile(file: File, ctx: BaseAudioContext): Promise<LoadedAudio> {
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  return { name: file.name, buffer, mono: mixToMono(buffer), sampleRate: buffer.sampleRate }
}

export function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  if (channels === 1) return buffer.getChannelData(0).slice()
  const mono = new Float32Array(buffer.length)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < mono.length; i++) mono[i] += data[i]
  }
  for (let i = 0; i < mono.length; i++) mono[i] /= channels
  return mono
}
