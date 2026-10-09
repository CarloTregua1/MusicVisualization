declare module 'fft.js' {
  type Arr = number[] | Float64Array | Float32Array
  export default class FFT {
    constructor(size: number)
    readonly size: number
    createComplexArray(): number[]
    toComplexArray(input: Arr, storage?: Arr): Arr
    fromComplexArray(complex: Arr, storage?: Arr): Arr
    completeSpectrum(spectrum: Arr): void
    transform(out: Arr, data: Arr): void
    realTransform(out: Arr, data: Arr): void
    inverseTransform(out: Arr, data: Arr): void
  }
}
