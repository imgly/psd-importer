export interface EncodeBufferToPNG {
  (
    rawImageBuffer: Uint8ClampedArray,
    imageWidth: number,
    imageHeight: number,
    backgroundColor?: { r: number; g: number; b: number; a: number }
  ): Promise<Blob>;
}
