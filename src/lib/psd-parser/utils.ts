import CreativeEngine, { BlendMode, DesignUnit } from "@cesdk/engine";
import Psd from "@webtoon/psd";

export const webtoonToCesdkBlendMode: { [key: string]: BlendMode } = {
  // unsupported types are commented out
  pass: "PassThrough",
  norm: "Normal",
  //   diss: "Dissolve",
  dark: "Darken",
  mul: "Multiply",
  idiv: "ColorBurn",
  //   lbrn: "LinearBurn",
  //   dkCl: "DarkerColor",
  lite: "Lighten",
  scrn: "Screen",
  div: "ColorDodge",
  //   lddg: "LinearDodge",
  //   lgCl: "LighterColor",
  over: "Overlay",
  sLit: "SoftLight",
  hLit: "HardLight",
  //   vLit: "VividLight",
  //   lLit: "LinearLight",
  //   pLit: "PinLight",
  //   hMix: "HardMix",
  diff: "Difference",
  smud: "Exclusion",
  //   fsub: "Subtract",
  //   fdiv: "Divide",
  hue: "Hue",
  sat: "Saturation",
  colr: "Color",
  lum: "Luminosity",
};

export function getDesignUnit(psd: Psd): DesignUnit {
  if (psd.resolutionInfo?.horizontalUnit === 2) {
    return "Millimeter";
  }
  return "Inch";
}

export function getScaleFactor(psd: Psd): number {
  // default scale factor
  let scaleFactor = 72;
  if (!psd.resolutionInfo) return scaleFactor;

  if (psd.resolutionInfo.horizontalUnit === 2) {
    // convert PixelsPerCM to PixelsPerMM
    return psd.resolutionInfo.horizontal * 10;
  }

  // PixelsPerInch
  return psd.resolutionInfo?.horizontal;
}

export async function waitUntilBlockIsReady(
  engine: CreativeEngine,
  block: number,
  timeout: number | null = 1000
) {
  // await until not pending text block
  const isPending = engine.block.getState(block).type === "Pending";
  if (isPending) {
    // wait for the block to be ready
    await new Promise<void>((resolve) => {
      engine.block.onStateChanged([block], ([block]) => {
        const state = engine.block.getState(block);
        if (state.type !== "Pending") {
          resolve();
        }
      });
      // Fallback if it never loads:
      if (timeout !== null) {
        setTimeout(resolve, timeout);
      }
    });
  }
}
