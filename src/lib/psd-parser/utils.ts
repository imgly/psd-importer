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

interface CharacterReplacement {
  index: number;
  character: string;
}
// The CE.SDK supports a syntax of `{{variableName}}` for text variables inside text blocks.
// This function replaces the curly braces so that it does not trigger the CE.SDK's text variable system.
// Returns an array of character indices where curly braces were replaced.
export function replaceTextVariables(
  engine: CreativeEngine,
  block: number,
  replacementCharacter = "*"
): CharacterReplacement[] {
  let text = engine.block.getString(block, "text/text");
  const indices: CharacterReplacement[] = [];

  text = text.replace(/\{\{[^}]+\}\}/g, (match, offset) => {
    indices.push({ index: offset, character: "{" });
    indices.push({ index: offset + 1, character: "{" });
    indices.push({ index: offset + match.length - 2, character: "}" });
    indices.push({ index: offset + match.length - 1, character: "}" });
    return `${replacementCharacter}${replacementCharacter}${match.slice(
      2,
      -2
    )}${replacementCharacter}${replacementCharacter}`;
  });

  engine.block.setString(block, "text/text", text);
  return indices.sort((a, b) => a.index - b.index);
}
// This function reverts the changes made by `replaceTextVariables` and restores the original text with text variables.
export function revertReplaceTextVariables(
  engine: CreativeEngine,
  block: number,
  indices: CharacterReplacement[]
) {
  let text = engine.block.getString(block, "text/text");

  // We start from the end of the array to avoid changing the indices of the characters that come after the current character.
  for (let i = indices.length - 1; i >= 0; i--) {
    engine.block.replaceText(
      block,
      indices[i].character,
      indices[i].index,
      indices[i].index + 1
    );
  }
}
