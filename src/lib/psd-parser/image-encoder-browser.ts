import { EncodeBufferToPNG } from "./image-encoder";

export function createWebEncodeBufferToPNG(): EncodeBufferToPNG {
  return function encodeBufferToPNG(
    rawImageBuffer: Uint8ClampedArray,
    imageWidth: number,
    imageHeight: number,
    backgroundColor?: { r: number; g: number; b: number; a: number }
  ): Promise<Blob> {
    if (typeof document === "undefined" || ImageData === undefined) {
      throw new Error(
        "This Image Encoder function can only be used in a browser environment"
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Could not get 2D context from canvas");
    }

    const imageBufferClamped = new Uint8ClampedArray(rawImageBuffer);
    const imageData = new ImageData(
      imageBufferClamped,
      imageWidth,
      imageHeight
    );

    if (backgroundColor) {
      const { r, g, b, a } = backgroundColor;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
      ctx.fillRect(0, 0, imageWidth, imageHeight);
    }

    ctx.putImageData(imageData, 0, 0);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create Blob"));
        }
      }, "image/png");
    });
  };
}
