import { EncodeBufferToPNG } from "./image-encoder";

export function createPNGJSEncodeBufferToPNG(
  PNG: typeof import("pngjs/browser").PNG
): EncodeBufferToPNG {
  if (!PNG) {
    throw new Error("PNGJS module not provided");
  }

  return async function encodeBufferToPNG(
    rawImageBuffer: Uint8ClampedArray,
    imageWidth: number,
    imageHeight: number,
    backgroundColor?: { r: number; g: number; b: number; a: number }
  ): Promise<Blob> {
    const png = new PNG({ width: imageWidth, height: imageHeight });

    // function to blend two colors with alpha
    const blendColor = (
      foreground: number,
      background: number,
      alpha: number
    ) => {
      return Math.round(foreground * alpha + background * (1 - alpha));
    };

    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const idx = (imageWidth * y + x) << 2; // calculate the index in the buffer

        // extract the raw image pixel color and alpha
        const rawR = rawImageBuffer[idx];
        const rawG = rawImageBuffer[idx + 1];
        const rawB = rawImageBuffer[idx + 2];
        const rawA = rawImageBuffer[idx + 3] / 255; // alpha value is between 0 and 1

        if (backgroundColor) {
          const { r, g, b, a } = backgroundColor;

          // blend the image pixel with the background color
          png.data[idx] = blendColor(rawR, r, rawA);
          png.data[idx + 1] = blendColor(rawG, g, rawA);
          png.data[idx + 2] = blendColor(rawB, b, rawA);
          // blend the alpha values: resulting alpha = foreground alpha + background alpha * (1 - foreground alpha)
          png.data[idx + 3] = Math.round(rawA * 255 + (1 - rawA) * a);
        } else {
          // if no background color is provided, copy the raw image pixel as-is
          png.data[idx] = rawR;
          png.data[idx + 1] = rawG;
          png.data[idx + 2] = rawB;
          png.data[idx + 3] = rawA * 255;
        }
      }
    }

    // encode the PNG data back to a buffer
    const buffer = PNG.sync.write(png);
    return new Blob([buffer], { type: "image/png" });
  };
}
