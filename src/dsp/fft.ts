import FFT from 'fft.js'

/** Real-input FFT with a reusable complex output buffer (interleaved re, im). */
export class RealFFT {
  readonly size: number
  readonly out: Float64Array
  private readonly fft: FFT

  constructor(size: number) {
    this.size = size
    this.fft = new FFT(size)
    this.out = new Float64Array(size * 2)
  }

  /** Transforms `input`; bins 0..size/2 of `out` are valid afterwards. */
  transform(input: Float64Array): Float64Array {
    this.fft.realTransform(this.out, input)
    return this.out
  }
}
