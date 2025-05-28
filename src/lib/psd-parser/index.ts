import type CreativeEngine from "@cesdk/engine";
import {
  BlendMode,
  CMYKColor,
  Color,
  FontStyle,
  FontWeight,
  RGBAColor,
  TextCase,
} from "@cesdk/engine";
import Psd, {
  Group,
  Layer,
  Node,
  NodeChild,
  NodeParent,
  PathRecordType,
} from "@webtoon/psd";
import {
  PathRecord,
  TypeToolObjectSettingAliBlock,
} from "@webtoon/psd/dist/interfaces";
// @ts-ignore
import opentype from "opentype.js";
import { parseColor } from "./color";
import type { TypefaceParams, TypefaceResolver } from "./font-resolver";
import defaultFontResolver from "./font-resolver";
import { EncodeBufferToPNG } from "./image-encoder";
import {
  PartialLayerFrame,
  StyleSheetData,
  TextProperties,
  VectorBooleanTypeItem,
  VectorObjectTypeItem,
  VectorPathRecordItem,
  VectorUnitTypeItem,
} from "./interfaces";
import { Logger } from "./logger";
import {
  replaceTextVariables,
  revertReplaceTextVariables,
  waitUntilBlockIsReady,
  webtoonToCesdkBlendMode,
} from "./utils";

/**
 * The pixel scale factor used in the CESDK Editor
 * This is used to convert the PSD file's pixel values to CESDK's design unit
 */
const DEFAULT_PIXEL_SCALE_FACTOR = 72;

const fontInfoMap: Record<
  string,
  {
    descender: number;
    ascender: number;
    unitsPerEm: number;
    factor: number;
  }
> = {};

interface Flags {
  applyClipMasks: boolean;
  enableTextFitting: boolean;
  enableTextVerticalAlignmentFix: boolean;
  enableTextTypefaceReachableCheck: boolean;
  enableCreateHiddenLayers: boolean;
  enableTopLevelGroupsArePages: boolean;
  groupsEnabled: boolean;
}
const FlagDefaults: Flags = {
  applyClipMasks: true,
  enableTextFitting: true,
  enableTextVerticalAlignmentFix: true,
  enableTextTypefaceReachableCheck: true,
  enableCreateHiddenLayers: false,
  enableTopLevelGroupsArePages: false,
  groupsEnabled: false,
};

interface Options {
  fontResolver: TypefaceResolver;
  flags: Flags;
}

export class PSDParser {
  private engine: CreativeEngine;
  private scene: number;
  private stack: number;
  private width: number;
  private height: number;
  private psd: Psd;
  private logger = new Logger();
  private fontResolver: TypefaceResolver;
  private encodeBufferToPNG: EncodeBufferToPNG;
  private flags: Flags;
  private groups: Map<number, number[]>;

  private constructor(
    engine: CreativeEngine,
    psd: Psd,
    encodeBufferToPNG: EncodeBufferToPNG,
    options: Partial<Options> = {}
  ) {
    if (!encodeBufferToPNG) {
      throw new Error("encodeBufferToPNG is required");
    }
    this.engine = engine;
    this.scene = 0;
    this.stack = 0;
    this.width = 0;
    this.height = 0;
    this.psd = psd;
    this.fontResolver = options.fontResolver ?? defaultFontResolver;
    this.encodeBufferToPNG = encodeBufferToPNG!;
    this.flags = options.flags ?? FlagDefaults;
    this.groups = new Map<number, number[]>();
  }

  static async fromFile(
    engine: CreativeEngine,
    fileBuffer: ArrayBuffer,
    encodeBufferToPNG: EncodeBufferToPNG,
    options: Partial<Options> = {}
  ) {
    try {
      const psdFile = Psd.parse(fileBuffer);
      return new PSDParser(engine, psdFile, encodeBufferToPNG, options);
    } catch (error) {
      throw new Error(
        `Error occurred during parsing the PSD file: ${error}. This file can not be imported.`
      );
    }
  }

  private async traverseNode(psdNode: Node, page: number) {
    // handle PSD node types
    if (psdNode.type === "Layer") {
      let layerBlockId: number;

      if (psdNode.isHidden && !this.flags.enableCreateHiddenLayers) return;

      await this.checkUnsupportedLayerFeatures(psdNode);
      if (psdNode.text) {
        layerBlockId = await this.createTextBlock(page, psdNode);
      } else {
        if (
          psdNode.additionalProperties.vmsk ||
          psdNode.additionalProperties.vscg ||
          psdNode.additionalProperties.vsms ||
          psdNode.additionalProperties.vstk
        ) {
          layerBlockId = await this.createVectorBlock(page, psdNode);
        } else {
          layerBlockId = await this.createImageBlock(page, psdNode);
          if (this.flags.applyClipMasks) {
            layerBlockId = this.applyParentClipMasks(
              psdNode,
              layerBlockId,
              page
            );
          }
        }
      }
      // if the layer is hidden, hide the block
      if (psdNode.isHidden) {
        this.engine.block.setVisible(layerBlockId, false);
      }
      if (this.engine.block.isValid(layerBlockId) && psdNode.name) {
        this.engine.block.setName(layerBlockId, psdNode.name);
      }
      // map the layers to their corresponding groups
      const groupId = (psdNode as unknown as PartialLayerFrame).layerFrame
        ?.layerProperties?.groupId;
      if (typeof groupId === "number" && !isNaN(groupId)) {
        if (!this.groups.has(groupId)) {
          this.groups.set(groupId, []);
        }
        if (this.engine.block.isValid(layerBlockId)) {
          this.groups.get(groupId)?.push(layerBlockId);
        } else {
          this.logger.log(
            `Invalid block '${layerBlockId}', name: ${psdNode.name}`,
            "warning"
          );
        }
      }
      // apply effects from parent
      this.applyTreeOpacity(layerBlockId, psdNode);
    } else if (psdNode.type === "Group") {
      // group handling
    } else if (psdNode.type === "Psd") {
      this.logger.log("Started analyzing the .PSD File");
    } else {
      throw new Error("Invalid node type");
    }

    if (psdNode.children) {
      for (const child of psdNode.children) {
        await this.traverseNode(child, page);
      }
    }
  }

  private async checkUnsupportedLayerFeatures(psdNode: Layer) {
    if (psdNode.additionalProperties.lfx2) {
      this.logger.log(
        `Layer '${psdNode.name}' has layer effects, which are not supported.`,
        "warning"
      );
    }

    const userMask = await psdNode.userMask();
    if (userMask) {
      this.logger.log(
        `Layer '${psdNode.name}' has a layer mask, which is not supported.`,
        "warning"
      );
    }
    const hasMask =
      // @ts-ignore
      ((psdNode as Layer).layerFrame?.layerProperties?.clippingMask ?? 0) !== 0;
    if (hasMask) {
      this.logger.log(
        `Layer '${psdNode.name}' has a clipping mask, which is not supported.`,
        "warning"
      );
    }
  }

  private applyParentClipMasks(
    psdNode: Layer,
    block: number,
    page: number
  ): number {
    const masks = [];
    let currentParent: NodeParent | undefined = psdNode.parent;
    // First we gather all the clip masks from the parent hierarchy
    while (currentParent) {
      const currentNode = currentParent as Group;
      currentParent = currentParent.parent;
      if (currentNode.type === "Group") {
        const maskBlock = this.createClipMaskLayer(currentNode, page);
        if (maskBlock) {
          masks.push(maskBlock);
        }
      }
    }

    if (masks.length === 0) return block;

    // If we have masks, we combine them with the block
    const oldWidth = this.engine.block.getWidth(block);
    const oldHeight = this.engine.block.getHeight(block);
    const oldPosX = this.engine.block.getPositionX(block);
    const oldPosY = this.engine.block.getPositionY(block);
    let newBlock = null;
    try {
      newBlock = this.engine.block.combine([block, ...masks], "Intersection");
    } catch (e) {
      // if e.g intersection is empty, delete mask block:
      masks.forEach(
        (block) =>
          this.engine.block.isValid(block) && this.engine.block.destroy(block)
      );
      return block;
    }
    const newWidth = this.engine.block.getWidth(newBlock);
    const newHeight = this.engine.block.getHeight(newBlock);
    const newPosX = this.engine.block.getPositionX(newBlock);
    const newPosY = this.engine.block.getPositionY(newBlock);

    // We need to adjust the crop scale and translation of the block so that it fits the old position and size of the image
    this.engine.block.setCropScaleX(newBlock, oldWidth / newWidth);
    this.engine.block.setCropScaleY(newBlock, oldHeight / newHeight);
    const newCropTranslationX = (oldPosX - newPosX) / newWidth;
    this.engine.block.setCropTranslationX(newBlock, newCropTranslationX);
    const newCropTranslationY = (oldPosY - newPosY) / newHeight;
    this.engine.block.setCropTranslationY(newBlock, newCropTranslationY);
    return newBlock;
  }

  /**
   * Creates a graphic block with the shape of the vector mask of the PSD node
   * @param psdNode The PSD node to extract the clip mask from
   * @returns A graphic block with the shape of the clip mask or null if no clip mask is present
   */
  private createClipMaskLayer(
    psdNode: Layer | Group,
    page: number
  ): number | null {
    const mask = psdNode.additionalProperties?.vmsk;

    // @ts-ignore
    const hasOwnMask = !!psdNode?.maskData?.parameters;
    if (hasOwnMask) {
      this.logger.log(
        `Layer '${psdNode.name}' has a clip mask, which is not supported.`,
        "warning"
      );
    }

    if (!mask) {
      return null;
    }

    const graphicBlock = this.engine.block.create("//ly.img.ubq/graphic");
    this.engine.block.setFillEnabled(graphicBlock, true);
    const fill = this.engine.block.createFill("color");
    this.engine.block.setFill(graphicBlock, fill);
    // The specific color is unimportant
    const red = { r: 1, g: 0, b: 0, a: 1 };
    this.engine.block.setColor(fill, "fill/color/value", red);

    this.engine.block.setKind(graphicBlock, "shape");
    const shape = this.engine.block.createShape(
      "//ly.img.ubq/shape/vector_path"
    );
    this.engine.block.setShape(graphicBlock, shape);

    const height = this.height;
    const width = this.width;
    this.engine.block.setWidth(graphicBlock, width);
    this.engine.block.setHeight(graphicBlock, height);
    // process path records
    let svgPath = this.buildShapeFromPathRecords(
      mask!.pathRecords,
      width,
      height
    );

    // set the vector path's path data, width, and height
    this.engine.block.setString(shape, "vector_path/path", svgPath);
    this.engine.block.setFloat(shape, "vector_path/width", width);
    this.engine.block.setFloat(shape, "vector_path/height", height);
    // append child to the page
    this.engine.block.appendChild(page, graphicBlock);
    return graphicBlock;
  }

  private async createGroups(groupsMap: Map<number, number[]>) {
    for (let [_, groupMembers] of groupsMap) {
      // groups does not work with the less than 1 members
      if (groupMembers.length <= 1) continue;
      try {
        const groupable = this.engine.block.isGroupable(groupMembers);
        if (!groupable) continue;
        this.engine.block.group(groupMembers);
      } catch (error) {
        this.logger.log(
          "Error occurred when trying to create a group" +
            `, blocks: '${groupMembers}', error: ${error}`,
          "warning"
        );
      }
    }
  }

  public async parse() {
    this.logger = new Logger();

    // get width and height from the PSD file
    this.width = this.psd.width;
    this.height = this.psd.height;

    await this.initScene();

    // We store which root element should be rendered on which page.
    // Normally, we would only have one page, but if the PSD file has top-level groups,
    // we support workflows to create a page for each top-level group.
    let pageRoots: {
      page: number;
      root: NodeChild | Psd;
    }[] = [];

    if (this.flags.enableTopLevelGroupsArePages) {
      //  Get all top level groups
      const topLevelGroups = this.psd.children.filter(
        (child) => child.type === "Group"
      );
      await Promise.all(
        topLevelGroups.map(async (group) => {
          const page = await this.createPage(this.stack);
          pageRoots.push({ page, root: group });
        })
      );
    } else {
      const page = await this.createPage(this.stack);
      pageRoots.push({ page, root: this.psd });
    }
    for (let i = 0; i < pageRoots.length; i++) {
      const { page, root } = pageRoots[i];
      await this.traverseNode(root, page);
    }

    if (this.flags.groupsEnabled) {
      await this.createGroups(this.groups);
    }

    return {
      scene: this.scene,
      logger: this.logger,
    };
  }

  private async initScene() {
    // initialize scene
    this.scene = this.engine.scene.create("VerticalStack");

    // get default stack
    this.stack = this.engine.block.findByType("//ly.img.ubq/stack")[0];

    // set standard values for the stack block:
    this.engine.block.setFloat(this.stack, "stack/spacing", 35);
    this.engine.block.setBool(this.stack, "stack/spacingInScreenspace", true);

    // set page format custom:
    this.engine.block.setString(this.scene, "scene/pageFormatId", "Custom");
    // psd always uses pixels as design unit for its dimensions
    this.engine.scene.setDesignUnit("Pixel");
    // set dpi to 72 since psd uses 72 dpi to size its texts
    this.engine.block.setFloat(this.scene, "scene/dpi", 72);
    this.engine.block.setFloat(
      this.scene,
      "scene/pageDimensions/width",
      this.width
    );
    this.engine.block.setFloat(
      this.scene,
      "scene/pageDimensions/height",
      this.height
    );
  }

  private async createPage(stack: number) {
    // create a page block
    const pageBlock = this.engine.block.create("//ly.img.ubq/page");

    // set the page name, width, and height
    this.engine.block.setName(pageBlock, this.psd.name);
    this.engine.block.setWidth(pageBlock, this.width);
    this.engine.block.setHeight(pageBlock, this.height);
    this.engine.block.setClipped(pageBlock, true);

    // disable the default page fill color
    this.engine.block.setFillEnabled(pageBlock, false);

    // append the page block to the stack block
    this.engine.block.appendChild(stack, pageBlock);

    return pageBlock;
  }

  private applyTreeOpacity(block: number, psdLayer: Layer): number {
    // opacity inside psd is in the range of 0-255, while in the CE.SDK it is in the range of 0-1
    let blendModeFillOpacity = this.getBlendModeFillOpacity(psdLayer) / 255;
    let layerOpacity = psdLayer.opacity / 255;
    // This is not fully correct, since blend mode fill is applied differently than the layer opacity in PhotoShop.
    // However, this is the best approximation we can do.
    let opacity = blendModeFillOpacity * layerOpacity;
    // For image fills, only parent opacity and blend mode fill opacity are applied.
    // Layer opacity is already included in the image.
    const fill = this.engine.block.getFill(block);
    if (
      this.engine.block.getType(fill) === "//ly.img.ubq/fill/image" &&
      !(
        psdLayer.additionalProperties.vmsk ||
        psdLayer.additionalProperties.vscg ||
        psdLayer.additionalProperties.vsms ||
        psdLayer.additionalProperties.vstk
      )
    ) {
      opacity = blendModeFillOpacity;
    }
    // Multiply by all ancestor opacities
    let parent: NodeParent | undefined = psdLayer.parent;
    while (parent) {
      // If parent is a group, check its blend mode
      const parentBlendMode = (parent as any)?.layerFrame?.layerProperties
        ?.blendMode;
      // "passThrough" means don't multiply group opacity (Photoshop semantics)
      if (parent.type === "Group" && parentBlendMode === "passThrough") {
        // skip multiplying opacity for passThrough groups
        parent = parent.parent;
        continue;
      }
      // combine and normalize
      opacity = (opacity * (parent.opacity ?? 255)) / 255;
      parent = parent.parent;
    }
    // Clamp opacity to [0, 1]
    opacity = Math.max(0, Math.min(1, opacity));
    this.engine.block.setOpacity(block, opacity);
    return opacity;
  }

  private async createTextBlock(
    pageBlock: number,
    psdLayer: Layer
  ): Promise<number> {
    // create a text block
    const textBlock = this.engine.block.create("//ly.img.ubq/text");

    // append the text block to the page
    this.engine.block.insertChild(pageBlock, textBlock, 0);

    // disable text clipping outside of the text frame
    // this was necessary because InDesign seems to have a lower threshold
    // for clipping the text than the CESDK Editor, which was causing parts
    // of the text to be clipped in the CESDK Editor
    this.engine.block.setBool(textBlock, "text/clipLinesOutsideOfFrame", false);

    // set the text content
    const textContent: string = psdLayer.text ? psdLayer.text : "";
    this.engine.block.setString(textBlock, "text/text", textContent);

    let textProperties: TextProperties;
    try {
      textProperties = psdLayer.textProperties as unknown as TextProperties;
    } catch (error) {
      this.logger.log(
        "Error occurred when trying to read text properties of Layer" +
          ` '${psdLayer.name}': ${error}`,
        "error"
      );
      throw error;
    }

    // extract font set
    const font = this.getTextFontSet(textProperties);

    if (!(font.family.toLowerCase() === "AdobeInvisFont".toLowerCase())) {
      // get the font URI from the font resolver
      const typefaceResponse = await this.fontResolver(font, this.engine);

      if (!typefaceResponse) {
        this.logger.log(
          "Could not find a typeface for the font family " +
            `'${font.family}' with weight '${font.weight}' and style '${font.style}'` +
            `, text: '${textContent}'`,
          "warning"
        );
      } else {
        const fontURI = typefaceResponse.font.uri;
        // Test if the font is loadable by creating a FontFace
        // If the font is loadable, we set the font URI on the text block
        // This was necessary because the CESDK will not render the text
        // if loading the font errors out
        try {
          if (this.flags.enableTextTypefaceReachableCheck) {
            // use fetch to see if the font is loadable
            if (!fontInfoMap[fontURI]) {
              const res = await fetch(fontURI);
              if (!res.ok) {
                throw new Error(`error loading font at ${fontURI}`);
              }
              const buffer = await res.arrayBuffer();
              const fontInfo = await opentype.parse(buffer);
              const factor =
                (fontInfo.ascender - fontInfo.descender) / fontInfo.unitsPerEm;
              const { ascender, descender, unitsPerEm } = fontInfo;
              fontInfoMap[fontURI] = {
                descender,
                ascender,
                unitsPerEm,
                factor,
              };
            }
          }
          this.engine.block.setFont(
            textBlock,
            fontURI,
            typefaceResponse.typeface
          );
        } catch (error) {
          this.logger.log(
            `Could not load font at '${fontURI}' ` +
              `for text: '${textContent}' due to: ${error}`,
            "error"
          );
        }
      }
    }

    // convert the text frame's dimensions from points to the CESDK design unit
    let x = psdLayer.left;
    let y = psdLayer.top;
    let width = psdLayer.width;
    let height = psdLayer.height;

    const TySh = psdLayer.additionalProperties.TySh;
    if (TySh) {
      function extractBoundsValue(
        position: string,
        transform: TypeToolObjectSettingAliBlock
      ): number {
        const bounds = transform.textData?.descriptor?.items?.get(
          "bounds"
        ) as VectorObjectTypeItem;
        return (bounds?.descriptor?.items?.get(position) as VectorUnitTypeItem)
          ?.value;
      }
      const left = extractBoundsValue("Left", TySh);
      const top = extractBoundsValue("Top ", TySh);
      const right = extractBoundsValue("Rght", TySh);
      const bottom = extractBoundsValue("Btom", TySh);

      if (left === undefined || top === undefined || right === undefined) {
        this.logger.log(
          `Could not extract bounds values from text block '${psdLayer.name}'. This could indicate an issue with the file. Please try to re-save the file from Photoshop.`,
          "error"
        );
        return textBlock;
      }

      function applyTransform(
        x: number,
        y: number,
        transform: TypeToolObjectSettingAliBlock
      ): { x: number; y: number } {
        const newX =
          transform.transformXX * x +
          // Since the CE.SDK is rotating in the opposite direction, we need to negate the Y component
          -transform.transformXY * y +
          transform.transformTX;
        const newY =
          // Since the CE.SDK is rotating in the opposite direction, we need to negate the X component
          -transform.transformYX * x +
          transform.transformYY * y +
          transform.transformTY;
        return { x: newX, y: newY };
      }

      const topLeft = applyTransform(left, top, TySh);
      const topRight = applyTransform(right, top, TySh);
      const bottomLeft = applyTransform(left, bottom, TySh);

      x = topLeft.x;
      y = topLeft.y;

      const distance = (
        a: { x: number; y: number },
        b: { x: number; y: number }
      ) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

      width = distance(topLeft, topRight);
      height = distance(topLeft, bottomLeft);
    }

    // set blend mode
    const blendMode = this.getBlendMode(psdLayer);
    if (blendMode) {
      this.engine.block.setBlendMode(textBlock, blendMode);
    }
    // apply rotation
    this.rotateBlock(textBlock, psdLayer);

    // set layer position
    this.engine.block.setWidth(textBlock, width);
    this.engine.block.setHeight(textBlock, height);
    this.engine.block.setPositionX(textBlock, x);
    this.engine.block.setPositionY(textBlock, y);

    // Calculate the baseline shift can be done like this:
    // const baseLineShift =
    //   textProperties.EngineDict?.StyleRun?.RunArray[0]?.StyleSheet
    //     ?.StyleSheetData.BaselineShift ?? 0;

    // const realBaseLineShift = this.scaleTextNumber(
    //   baseLineShift,
    //   psdLayer.additionalProperties.TySh ?? null,
    //   this.scaleFactor
    // );
    // this.moveTextInTextDirection(textBlock, 0, realBaseLineShift);
    // However, this baseline shift is already applied to the calculated text block bounding box.
    // So currently we do not need to apply it again.

    // Currently, the CE.SDK does not support kerning and letter spacing for text runs inside a text block.
    let kerningSum = 0;
    let letterSpacingSum = 0;
    // Since we want to treat the text from Photoshop in the same way inside the CE.SDK,
    // we need to "disable" the text variable system of the CE.SDK before applying any styling.
    // Later, we "enable" text variables again by reverting the changes.
    const replacedCharacters = replaceTextVariables(this.engine, textBlock);
    // check for style(s) of text content section(s)
    const styleRunLengthArray =
      textProperties.EngineDict?.StyleRun?.RunLengthArray;
    if (styleRunLengthArray) {
      // first character of the text content
      let textSectionStart = 0;
      // styleRunLengthArray contains the length of each text style run in characters
      interface StyleRun {
        from: number;
        to: number;
        styleSheetData: StyleSheetData;
      }
      const styleRuns: StyleRun[] = styleRunLengthArray
        .map((len, index) => {
          const from = textSectionStart;
          const styleRun = textProperties.EngineDict?.StyleRun?.RunArray[index];
          const styleSheetData = styleRun?.StyleSheet?.StyleSheetData;
          const isLast = index === styleRunLengthArray.length - 1;
          const lastOffset = isLast ? -1 : 0;
          const to = textSectionStart + len + lastOffset;
          if (!styleSheetData || from >= to) return false;
          textSectionStart += len;
          return { from, to, styleSheetData };
        })
        .filter((b) => b !== false) as StyleRun[];
      styleRuns.forEach(({ from, to, styleSheetData }) => {
        // set text case
        const fontCaps = styleSheetData.FontCaps;
        if (fontCaps) {
          const mapping: Record<number, TextCase> = {
            1: "Lowercase",
            2: "Uppercase",
          };
          const textCase = mapping[fontCaps] ?? "Normal";
          this.engine.block.setTextCase(textBlock, textCase, from, to);
        }

        // apply bold
        if (styleSheetData.FauxBold) {
          if (this.engine.block.canToggleBoldFont(textBlock, from, to)) {
            this.engine.block.toggleBoldFont(textBlock, from, to);
          } else {
            this.logger.log(
              `Could not make text "${
                textContent.substring(from, to).trim().slice(0, 10) + "..."
              }" bold. This might be due to a missing bold version of the font.`,
              "error"
            );
          }
        }

        // apply italic
        if (styleSheetData.FauxItalic) {
          if (this.engine.block.canToggleItalicFont(textBlock, from, to)) {
            this.engine.block.toggleItalicFont(textBlock, from, to);
          } else {
            this.logger.log(
              `Could not make text "${
                textContent.substring(from, to).trim().slice(0, 10) + "..."
              })" italic. This might be due to a missing italic version of the font.`,
              "error"
            );
          }
        }

        // set text fill color
        const textFillColor = this.getStyleSheetColor(
          this.getTextValue(textProperties, styleSheetData, "FillColor")
        );
        if (textFillColor) {
          this.engine.block.setTextColor(textBlock, textFillColor, from, to);
        } else {
          this.logger.log(
            `Text fill color not found for text part '${textContent.substring(
              from,
              to
            )}', text: '${textContent}', using the default color`,
            "warning"
          );
        }

        // accumulate letter spacing
        letterSpacingSum += (styleSheetData.Tracking ?? 0) * (to - from);
        // accumulate kerning
        kerningSum = (styleSheetData.Kerning ?? 0) * (to - from);
      });
    }

    const fontSizes = styleRunLengthArray?.map((len, index) => {
      const styleRun = textProperties.EngineDict?.StyleRun?.RunArray[index];
      const styleSheetData = styleRun?.StyleSheet?.StyleSheetData;
      return this.getTextValue(textProperties, styleSheetData, "FontSize");
    });
    const fontSizeSet = new Set(fontSizes);
    if (fontSizeSet.size > 1) {
      this.logger.log(
        `Text '${psdLayer.name}' has multiple different text sizes inside the style runs. ` +
          `This is currently not supported by the CE.SDK. ` +
          `The text will be rendered with the first font size found.`,
        "warning"
      );
    }

    const TEXT_SHAPE_TYPES: Record<string, "Fixed" | "Auto"> = {
      "1": "Fixed",
      "0": "Auto",
    };
    const textShapeType =
      textProperties.EngineDict?.Rendered?.Shapes?.Children[0].ShapeType;
    const textBoxShape = TEXT_SHAPE_TYPES[textShapeType] ?? "Fixed";

    // set the font size
    // CE.SDK currently only supports a single font size for the entire content
    const firstRunStyleSheet =
      textProperties.EngineDict?.StyleRun?.RunArray[0].StyleSheet;
    const textFontSizeAttribute = this.getTextValue(
      textProperties,
      firstRunStyleSheet?.StyleSheetData,
      "FontSize"
    );
    const textFontSize = this.scaleTextNumber(
      textFontSizeAttribute,
      psdLayer.additionalProperties.TySh ?? null
    );
    this.engine.block.setFloat(textBlock, "text/fontSize", textFontSize);

    // extract paragraph features
    const paragraphRunArray = textProperties.EngineDict?.ParagraphRun?.RunArray;
    if (paragraphRunArray) {
      // extract justification from the first part
      const justification =
        paragraphRunArray[0]?.ParagraphSheet?.Properties?.Justification;
      const mapping: Record<string, string> = {
        "0": "Left",
        "1": "Right",
        "2": "Center",
        // "3": "Justified", // Justified is not supported in CE.SDK
      };
      const justificationValue = mapping[justification] ?? "Left";
      this.engine.block.setEnum(
        textBlock,
        "text/horizontalAlignment",
        justificationValue
      );
    }

    // set text stroke color
    const textStrokeColor = this.getTextStrokeColor(textProperties, 0);
    if (textStrokeColor) {
      const outlineWidth = firstRunStyleSheet.StyleSheetData?.OutlineWidth ?? 1;
      this.engine.block.setStrokeEnabled(textBlock, true);
      this.engine.block.setStrokeWidth(textBlock, outlineWidth);
      this.engine.block.setStrokeColor(textBlock, {
        r: textStrokeColor.r / 255.0,
        g: textStrokeColor.g / 255.0,
        b: textStrokeColor.b / 255.0,
        a: textStrokeColor.a / 100.0,
      });
    }

    // add average kerning and average letter spacing
    const realLetterSpacing =
      (letterSpacingSum / 10 / 100 + kerningSum / 10 / 100) /
      textContent.length;
    this.engine.block.setFloat(
      textBlock,
      "text/letterSpacing",
      realLetterSpacing
    );

    // set line height
    let lineHeight = this.getLineHeight(textProperties);
    if (lineHeight) {
      const fontUri = this.engine.block.getString(
        textBlock,
        "text/fontFileUri"
      );
      // Correct for differences in line height calculation between Photoshop and CE.SDK
      if (fontInfoMap[fontUri]) {
        lineHeight = lineHeight / fontInfoMap[fontUri].factor;
      }
      this.engine.block.setFloat(textBlock, "text/lineHeight", lineHeight);
    }
    // enable text variables again:
    revertReplaceTextVariables(this.engine, textBlock, replacedCharacters);

    // Function to adjust text to fit on one line if necessary
    if (textBoxShape === "Auto" && this.flags.enableTextFitting) {
      await this.textFitting(textBlock);
    }
    if (this.flags.enableTextVerticalAlignmentFix) {
      this.textVerticalAlignmentFix(textBlock);
    }
    // TODO: Enable if text auto width mode works correctly
    // if (textBoxShape === "Auto") {
    //   this.engine.block.setHeightMode(textBlock, "Auto");
    //   this.engine.block.setWidthMode(textBlock, "Auto");
    // }
    // We would normally now clip lines outside of the frame.
    // However, this would could off the last lines of paragraphs, due to tiny differences in rendering
    // else if(textBoxShape === "Fixed") {
    //   this.engine.block.setBool(textBlock, "text/clipLinesOutsideOfFrame", true)
    // }

    return textBlock;
  }

  private moveTextInTextDirection(textBlock: number, dx: number, dy: number) {
    // Convert rotation from degrees to radians
    const rotationRad = this.engine.block.getRotation(textBlock);

    // Calculate the direction vectors
    const cosTheta = Math.cos(rotationRad);
    const sinTheta = Math.sin(rotationRad);

    // Calculate the new position
    const x = this.engine.block.getPositionX(textBlock);
    const y = this.engine.block.getPositionY(textBlock);
    const newX = x + (dx * cosTheta - dy * sinTheta);
    const newY = y + (dx * sinTheta + dy * cosTheta);

    // Update the text block's position
    this.engine.block.setPositionX(textBlock, newX);
    this.engine.block.setPositionY(textBlock, newY);

    return textBlock;
  }

  private textVerticalAlignmentFix(textBlock: number) {
    const fontSize = this.engine.block.getFloat(textBlock, "text/fontSize");
    const fontUri = this.engine.block.getString(textBlock, "text/fontFileUri");
    const fontInfo = fontInfoMap[fontUri];
    if (fontInfo) {
      // Honestly, I don't know why this works, but it does
      const offset =
        (((-fontInfo.descender + fontInfo.ascender - fontInfo.unitsPerEm) /
          fontInfo.unitsPerEm) *
          fontSize) /
        2;
      this.moveTextInTextDirection(textBlock, 0, -offset);
    }
  }

  // Function to adjust text letter spacing up until a certain point to see if we can reduce a line
  private async textFitting(
    textBlock: number,
    step = 0.001,
    maxAdjustmentSteps = 500
  ) {
    // await until not pending text block
    await waitUntilBlockIsReady(this.engine, textBlock);
    const originalHeight = this.engine.block.getHeight(textBlock);

    // Set height to auto to allow natural text flow
    this.engine.block.setHeightMode(textBlock, "Auto");
    const originalLetterSpacing = this.engine.block.getFloat(
      textBlock,
      "text/letterSpacing"
    );

    const fontSize = this.engine.block.getFloat(textBlock, "text/fontSize");

    // Function to check if the text block is overflowing
    // This is done by comparing the frame height in "auto" height mode to the real text block height
    const isOverflowing = (
      textBlock: number,
      realTextBlockHeight: number
    ): boolean => {
      const textBlockHeight = this.engine.block.getFrameHeight(textBlock);
      const isOverflowing =
        textBlockHeight - realTextBlockHeight > fontSize / 2;
      return isOverflowing;
    };
    const isPerfectFit = (
      textBlock: number,
      realTextBlockHeight: number
    ): boolean => {
      const overflowingNow = isOverflowing(textBlock, realTextBlockHeight);
      // reduce the letter spacing by STEP to see if the text fits on one line
      const currentLetterSpacing = this.engine.block.getFloat(
        textBlock,
        "text/letterSpacing"
      );
      this.engine.block.setFloat(
        textBlock,
        "text/letterSpacing",
        currentLetterSpacing - step
      );
      const overflowingAfter = isOverflowing(textBlock, realTextBlockHeight);
      if (overflowingNow && !overflowingAfter) {
        return true;
      } else {
        return false;
      }
    };

    // Perfect fit letter spacing is achieved when
    // 1. increasing the letter spacing by STEP will cause the text to overflow into the next line
    // 2. the perfect letter spacing creates a text block with a real frame height equal to the original frame height
    // This means that we might either increase or decrease the letter spacing to find the perfect fit
    // This algorithm should not be executed for "Fixed" height mode PSD text blocks
    let counter = 0;
    let maxCounter = Math.sqrt(maxAdjustmentSteps);
    const recursiveLetterSpacingChange = (
      block: number,
      minLetterSpacingChange: number,
      maxLetterSpacingChange: number
    ): number | null => {
      if (counter > maxCounter) {
        return null;
      }
      counter++;
      const perfectFit = isPerfectFit(block, originalHeight);
      if (perfectFit) {
        return this.engine.block.getFloat(block, "text/letterSpacing");
      }
      // If we did not find a perfect fit, we need to search for it
      // We test the middle of the current range
      const middleSteps = Math.round(
        (minLetterSpacingChange + maxLetterSpacingChange) / 2
      );
      const newLetterSpacing = originalLetterSpacing + middleSteps * step;
      this.engine.block.setFloat(block, "text/letterSpacing", newLetterSpacing);
      if (isOverflowing(block, originalHeight)) {
        // if we are overflowing, search for the perfect fit in the lower half
        return recursiveLetterSpacingChange(
          block,
          minLetterSpacingChange,
          middleSteps
        );
      } else {
        // if we are not overflowing, search for the perfect fit in the upper half
        return recursiveLetterSpacingChange(
          block,
          middleSteps,
          maxLetterSpacingChange
        );
      }
    };
    const realLetterSpacing = recursiveLetterSpacingChange(
      textBlock,
      -maxAdjustmentSteps,
      maxAdjustmentSteps
    );
    // if we did not find a perfect fit, reset the letter spacing
    if (!realLetterSpacing) {
      const content = this.engine.block.getString(textBlock, "text/text");
      this.logger.log(
        `Could not find a perfect fit for the text block with text "${content.slice(
          0,
          10
        )}..."`,
        "warning"
      );
      this.engine.block.setFloat(
        textBlock,
        "text/letterSpacing",
        originalLetterSpacing
      );
    }
    // Reset height to original
    this.engine.block.setHeightMode(textBlock, "Absolute");
    this.engine.block.setHeight(textBlock, originalHeight);
  }

  private getTextFontSet(textProperties: TextProperties): TypefaceParams {
    let fontSet = textProperties.ResourceDict?.FontSet;
    if (!fontSet) {
      fontSet = textProperties.DocumentResources?.FontSet;
      if (!fontSet) {
        this.logger.log(
          "Font set not found, using the default font set",
          "warning"
        );
        return { family: "Roboto", style: "normal", weight: "normal" };
      }
    }

    // using the first font in the font set
    // as cesdk only supports single font for a text layer
    let namePart = fontSet[0].Name;
    let stylePart: FontStyle = "normal";
    let weightPart: FontWeight = "normal";
    // based on font-resolvers.ts/fontVariantMap
    const weightKeywords = [
      "Thin",
      "Extra-light",
      "ExtraLight",
      "Light",
      "Regular",
      "Medium",
      "Semi-bold",
      "SemiBold",
      "Bold",
      "Extra-bold",
      "ExtraBold",
      "Black",
      "Heavy",
    ];

    const weightMap: Record<string, FontWeight> = {
      Thin: "thin",
      "Extra-light": "extraLight",
      ExtraLight: "extraLight",
      Light: "light",
      Regular: "normal",
      Medium: "medium",
      "Semi-bold": "semiBold",
      SemiBold: "semiBold",
      Bold: "bold",
      "Extra-bold": "extraBold",
      ExtraBold: "extraBold",
      Black: "heavy",
      Heavy: "heavy",
    };

    // normalize font name to lowercase
    const fontName = fontSet[0].Name.toLowerCase();

    // regular italic case
    if (fontName.endsWith("-italic")) {
      return {
        family: namePart.slice(0, -"-italic".length),
        style: "italic",
        weight: "normal",
      };
    }
    // regular oblique case
    if (fontName.endsWith("-oblique")) {
      return {
        family: namePart.slice(0, -"-oblique".length),
        style: "italic",
        weight: "normal",
      };
    }

    // looping through weight keywords
    for (const keyword of weightKeywords) {
      const wightName = `-${keyword}`.toLowerCase();
      if (fontName.includes(wightName)) {
        const parts = fontName.split(wightName);
        namePart = namePart.slice(0, parts[0].length);
        weightPart = weightMap[keyword];
        if (fontName.includes("italic") || fontName.includes("oblique")) {
          stylePart = "italic";
        }
        break;
      }
    }

    return {
      family: namePart,
      style: stylePart,
      weight: weightPart,
    };
  }

  private getStyleSheetColor = (
    value:
      | {
          Type: number;
          Values: number[];
        }
      | undefined
      | null
  ): Color | null => {
    const color = value?.Values;
    if (!color) return null;

    // RGBA
    if (value.Type === 1) {
      return { r: color[1], g: color[2], b: color[3], a: color[0] };
    } else if (value.Type === 2) {
      // CMYK
      // This does not work:
      // const tint = color[0];
      const tint = 1;
      const c = color[1];
      const m = color[2];
      const y = color[3];
      const k = color[4];
      const convertedColor: CMYKColor = { c, m, y, k, tint };
      return convertedColor;
    }
    return null;
  };

  private getTextValue(
    textProperties: TextProperties,
    styleRunStyleSheetData: any,
    property: string
  ): any | null {
    const styleSheets = [
      styleRunStyleSheetData,
      textProperties.ResourceDict?.StyleSheetSet[0]?.StyleSheetData,
      textProperties.DocumentResources?.StyleSheetSet[0]?.StyleSheetData,
    ];
    for (const styleSheet of styleSheets) {
      const propertyValue = styleSheet?.[property];
      if (propertyValue) {
        return propertyValue;
      }
    }
    return null;
  }

  private getTextStrokeColor(
    textProperties: TextProperties,
    index: number
  ): RGBAColor | null {
    if (
      textProperties.EngineDict?.StyleRun?.RunArray[index]?.StyleSheet
        ?.StyleSheetData?.StrokeColor?.Values
    ) {
      const color =
        textProperties.EngineDict.StyleRun.RunArray[index].StyleSheet
          .StyleSheetData.StrokeColor.Values;
      return { r: color[1], g: color[2], b: color[3], a: color[0] };
    }

    return null;
  }

  /**
   * This function scales a text attribute based on the scaling factor of the PSD file
   * @param textAttribute The text attribute to scale
   * @param TySh The TypeToolObjectSettingAliBlock object
   * @param dpi The DPI of the PSD file. Default is 72
   * @returns returns the scaled text attribute
   */
  private scaleTextNumber(
    textAttribute: number,
    TySh: TypeToolObjectSettingAliBlock | null = null,
    dpi = 72
  ): number {
    const fontSizePt = textAttribute;

    // Calculate points to pixels conversion factor
    const pointsToPixelsConversion = dpi / 72;
    let fontSizePx = fontSizePt / pointsToPixelsConversion;
    if (!TySh) return fontSizePx;

    // calculate and apply scaling
    const { transformXX, transformXY, transformYX, transformYY } = TySh;
    const scaleX = Math.sqrt(
      transformXX * transformXX + transformXY * transformXY
    );
    const scaleY = Math.sqrt(
      transformYY * transformYY + transformYX * transformYX
    );
    const scaleCoefficient = (scaleX + scaleY) / 2; // Average of the scales;
    if (!scaleCoefficient) return fontSizePx;
    const scaledFontSize = fontSizePx * scaleCoefficient;
    return scaledFontSize;
  }

  private getLineHeight(textProperties: TextProperties): number {
    const DEFAULT_LINE_HEIGHT_FACTOR = 1.2;

    const stylesheet =
      textProperties.EngineDict?.StyleRun?.RunArray[0]?.StyleSheet
        .StyleSheetData;
    if (stylesheet.AutoLeading === true) {
      const firstParagraphRun =
        textProperties.EngineDict?.ParagraphRun?.RunArray[0];
      const autoLeading =
        firstParagraphRun?.ParagraphSheet?.Properties?.AutoLeading;
      if (autoLeading !== undefined) return autoLeading;

      this.logger.log(
        `Could not extract auto leading from text block. Using default line height of ${DEFAULT_LINE_HEIGHT_FACTOR}`,
        "warning"
      );
      return DEFAULT_LINE_HEIGHT_FACTOR;
    }
    let lineHeight = DEFAULT_LINE_HEIGHT_FACTOR;
    if (
      stylesheet?.Leading === undefined ||
      stylesheet?.FontSize === undefined
    ) {
      this.logger.log(
        `Could not extract line height from text block. Using default line height of ${DEFAULT_LINE_HEIGHT_FACTOR}`,
        "warning"
      );
      return DEFAULT_LINE_HEIGHT_FACTOR;
    }
    lineHeight = stylesheet.Leading / stylesheet.FontSize;
    // If we have a line height that is too small to make sense, it indicates that the line height is set incorrectly in the PSD.
    // We thus set it to a default value line height value
    if (lineHeight < 0.6) {
      const textContent = this.engine.block.getString(
        this.engine.block.create("//ly.img.ubq/text"),
        "text/text"
      );
      const shortTextContent =
        textContent.length > 10
          ? textContent.substring(0, 10) + "..."
          : textContent;

      this.logger.log(
        `Line height of block with text "${shortTextContent}" is too small. Setting to default value.`,
        "warning"
      );
      return DEFAULT_LINE_HEIGHT_FACTOR;
    }
    return lineHeight;
  }

  private async createImageBlock(
    pageBlock: number,
    psdLayer: Layer
  ): Promise<number> {
    console.log("Creating image block for layer:", psdLayer.name);
    // extract the pixel data of a layer, with only the layer's own effects applied
    const compositeBuffer = await psdLayer.composite(true, false);

    // check for solid color background
    const SoCo = psdLayer.additionalProperties.SoCo;
    let bgColor = undefined;
    if (SoCo) {
      const clr_ = SoCo.data.items.get("Clr ") as VectorObjectTypeItem;
      const color = parseColor(clr_) ?? { r: 0, g: 0, b: 0, a: 1 };
      // only if we have an RGB color:
      if ("r" in color && "g" in color && "b" in color && "a" in color) {
        bgColor = {
          r: color.r * 255,
          g: color.g * 255,
          b: color.b * 255,
          a: color.a * 255,
        };
      }
    }

    const imgBlob = await this.encodeBufferToPNG(
      compositeBuffer,
      psdLayer.width,
      psdLayer.height,
      bgColor
    );

    const imageURI = URL.createObjectURL(imgBlob);

    const imageBlock = this.engine.block.create("//ly.img.ubq/graphic");
    const rectFrame = this.engine.block.createShape("//ly.img.ubq/shape/rect");
    const fillType = this.engine.block.createFill("//ly.img.ubq/fill/image");

    this.engine.block.setShape(imageBlock, rectFrame);
    this.engine.block.setFill(imageBlock, fillType);
    this.engine.block.setKind(imageBlock, "image");
    this.engine.block.setString(fillType, "fill/image/imageFileURI", imageURI);

    // append the text block to the page
    this.engine.block.insertChild(pageBlock, imageBlock, 0);

    // convert the image frame's dimensions from points to the CESDK design unit
    const x = psdLayer.left;
    const y = psdLayer.top;
    const width = psdLayer.width;
    const height = psdLayer.height;

    // set blend mode
    const blendMode = this.getBlendMode(psdLayer);
    if (blendMode) {
      this.engine.block.setBlendMode(imageBlock, blendMode);
    }

    // set layer position
    this.engine.block.setPositionX(imageBlock, x);
    this.engine.block.setPositionY(imageBlock, y);
    this.engine.block.setWidth(imageBlock, width);
    this.engine.block.setHeight(imageBlock, height);

    // apply rotation
    this.rotateBlock(imageBlock, psdLayer);

    return imageBlock;
  }

  private getSvgMoveTo(
    record: VectorPathRecordItem,
    w: number,
    h: number
  ): string {
    const aHoriz = record.anchor.horiz * w;
    const aVert = record.anchor.vert * h;
    return `M ${aHoriz},${aVert} `;
  }

  private getSvgCurve(
    previous: VectorPathRecordItem,
    current: VectorPathRecordItem,
    w: number,
    h: number
  ): string {
    const pHoriz = previous.leaving.horiz * w;
    const pVert = previous.leaving.vert * h;
    const aHoriz = current.anchor.horiz * w;
    const aVert = current.anchor.vert * h;
    const lHoriz = current.preceding.horiz * w;
    const lVert = current.preceding.vert * h;
    return `C ${pHoriz},${pVert} ${lHoriz},${lVert} ${aHoriz},${aVert} `;
  }

  private async createVectorBlock(
    pageBlock: number,
    psdLayer: Layer
  ): Promise<number> {
    const graphicBlock = this.engine.block.create("//ly.img.ubq/graphic");

    // must be the size of the whole image
    const x = 0;
    const y = 0;
    const width = this.width;
    const height = this.height;

    // set blend mode
    const blendMode = this.getBlendMode(psdLayer);
    if (blendMode) {
      this.engine.block.setBlendMode(graphicBlock, blendMode);
    }

    // set layer position
    this.engine.block.setPositionX(graphicBlock, psdLayer.left);
    this.engine.block.setPositionY(graphicBlock, psdLayer.top);
    this.engine.block.setWidth(graphicBlock, psdLayer.width);
    this.engine.block.setHeight(graphicBlock, psdLayer.height);

    // apply rotation
    this.rotateBlock(graphicBlock, psdLayer);

    // append the text block to the page
    this.engine.block.insertChild(pageBlock, graphicBlock, 0);

    // shared values between vmsk and (vscg, vsms, vstk)
    let pathRecords: PathRecord[] = [];
    let color: RGBAColor = {
      r: 0,
      g: 0,
      b: 0,
      a: psdLayer.opacity / 255.0,
    };

    // vmsk and (vscg, vsms, vstk) must be processed separately
    if (psdLayer.additionalProperties.vmsk) {
      // set pathRecords
      pathRecords = psdLayer.additionalProperties.vmsk.pathRecords;

      // extract the pixel data of a layer, with only the layer's own effects applied
      const compositeBuffer = await psdLayer.composite(true, false);

      // check for solid color background
      const SoCo = psdLayer.additionalProperties.SoCo;
      let bgColor = undefined;
      if (SoCo) {
        const clr_ = SoCo.data.items.get("Clr ") as VectorObjectTypeItem;
        const color = parseColor(clr_) ?? { r: 0, g: 0, b: 0, a: 1 };
        // only if we have an RGB color:
        if ("r" in color && "g" in color && "b" in color && "a" in color) {
          bgColor = {
            r: color.r * 255,
            g: color.g * 255,
            b: color.b * 255,
            a: color.a * 255,
          };
        }
      }

      const imgBlob = await this.encodeBufferToPNG(
        compositeBuffer,
        psdLayer.width,
        psdLayer.height,
        bgColor
      );

      const imageURI = URL.createObjectURL(imgBlob);

      // set fill
      const fillType = this.engine.block.createFill("//ly.img.ubq/fill/image");
      this.engine.block.setFill(graphicBlock, fillType);
      // this.engine.block.setKind(graphicBlock, "image");
      this.engine.block.setString(
        fillType,
        "fill/image/imageFileURI",
        imageURI
      );
    } else if (psdLayer.additionalProperties.vscg) {
      // handling vector stroke content data
      const vscg = psdLayer.additionalProperties.vscg;

      const clr_ = vscg.data.descriptor.items.get(
        "Clr "
      ) as VectorObjectTypeItem;
      const color = parseColor(clr_) ?? { r: 0, g: 0, b: 0, a: 1 };
      if (psdLayer.additionalProperties.vsms) {
        // handling vector mask setting
        const vsms = psdLayer.additionalProperties.vsms;
        pathRecords = vsms.pathRecords;
      }

      // set fill
      const fill = this.engine.block.createFill("color");
      this.engine.block.setColor(fill, "fill/color/value", color);
      this.engine.block.setFill(graphicBlock, fill);
    }

    // shared values has been extracted
    // now start drawing
    // create a vector path block
    this.engine.block.setKind(graphicBlock, "shape");
    const shape = this.engine.block.createShape(
      "//ly.img.ubq/shape/vector_path"
    );
    this.engine.block.setShape(graphicBlock, shape);

    // process path records
    let svgPath = this.buildShapeFromPathRecords(
      pathRecords,
      this.width,
      this.height,
      // We need to apply the offset to the path records. This moves all points to the top left corner
      -(psdLayer.left / this.width),
      -(psdLayer.top / this.height)
    );

    // set the vector path's path data, width, and height
    this.engine.block.setString(shape, "vector_path/path", svgPath);
    this.engine.block.setFloat(shape, "vector_path/width", psdLayer.width);
    this.engine.block.setFloat(shape, "vector_path/height", psdLayer.height);

    const gradient = psdLayer.additionalProperties.GdFl;
    if (gradient) {
      // Currently unsupported
      this.logger.log("Gradient fills are currently not supported", "warning");
    }
    // check for vector stroke data
    if (psdLayer.additionalProperties.vstk) {
      const vstk = psdLayer.additionalProperties.vstk;

      // get vector stroke width
      const strokeWidth = vstk.data.descriptor.items.get(
        "strokeStyleLineWidth"
      ) as VectorUnitTypeItem;

      // get vector stroke opacity
      const strokeOpacity = vstk.data.descriptor.items.get(
        "strokeStyleOpacity"
      ) as VectorUnitTypeItem;

      // get vector stroke style
      const strokeStyle = vstk.data.descriptor.items.get(
        "strokeStyleContent"
      ) as VectorObjectTypeItem;
      // get vector stroke color
      const clr__ = strokeStyle.descriptor.items.get(
        "Clr "
      ) as VectorObjectTypeItem;
      let color = parseColor(clr__);
      if (!color) {
        this.logger.log("Could not parse color for stroke", "warning");
        color = { r: 0, g: 0, b: 0, a: 1 };
      }
      // set vector stroke data
      const strokeEnabledFlag = vstk.data.descriptor.items.get(
        "strokeEnabled"
      ) as VectorBooleanTypeItem;
      // get fill enabled flag
      const fillEnabledFlag = vstk.data.descriptor.items.get(
        "fillEnabled"
      ) as VectorBooleanTypeItem;
      // set fill enabled flag:
      this.engine.block.setFillEnabled(graphicBlock, fillEnabledFlag.value);
      this.engine.block.setStrokeEnabled(graphicBlock, strokeEnabledFlag.value);
      this.engine.block.setStrokeWidth(graphicBlock, strokeWidth.value);
      if ("a" in color) {
        color.a = strokeOpacity.value / 100.0;
      }
      this.engine.block.setStrokeColor(graphicBlock, color);
    }
    return graphicBlock;
  }

  private buildShapeFromPathRecords(
    pathRecords: PathRecord[],
    width: number,
    height: number,
    offsetX = 0,
    offsetY = 0
  ) {
    let pathFillRule = false;
    let initialFillRule = false;
    let isFirstPoint = true;
    let previousPoint = null;
    let firstPoint = null;
    let isClosed = true;

    let svgPath = "";
    for (const record of pathRecords) {
      // apply offsets and normalize values:
      const normalize = (value: number) => {
        // a 255 indicates a negative value
        // get bitwise representation of the number
        if (value < 200) {
          return value;
        }
        return value - 256;
      };
      if ("anchor" in record && record.anchor !== null) {
        record.anchor.horiz = normalize(record.anchor.horiz);
        record.anchor.vert = normalize(record.anchor.vert);
        record.anchor.horiz += offsetX;
        record.anchor.vert += offsetY;
      }
      if ("leaving" in record && record.leaving !== null) {
        record.leaving.horiz = normalize(record.leaving.horiz);
        record.leaving.vert = normalize(record.leaving.vert);
        record.leaving.horiz += offsetX;
        record.leaving.vert += offsetY;
      }
      if ("preceding" in record && record.preceding !== null) {
        record.preceding.horiz = normalize(record.preceding.horiz);
        record.preceding.vert = normalize(record.preceding.vert);
        record.preceding.horiz += offsetX;
        record.preceding.vert += offsetY;
      }

      switch (record.type) {
        case PathRecordType.ClosedSubpathBezierKnotLinked:
        case PathRecordType.ClosedSubpathBezierKnotUnlinked:
        case PathRecordType.OpenSubpathBezierKnotLinked:
        case PathRecordType.OpenSubpathBezierKnotUnlinked:
          // check if the path is open
          if (
            record.type === PathRecordType.OpenSubpathBezierKnotLinked ||
            record.type === PathRecordType.OpenSubpathBezierKnotUnlinked
          ) {
            isClosed = false;
          }

          // check if the record is actually the first node
          if (isFirstPoint) {
            firstPoint = record;
            isFirstPoint = false;
          } else if (previousPoint) {
            const curve = this.getSvgCurve(
              previousPoint,
              record,
              width,
              height
            );
            svgPath += curve;
          }
          previousPoint = record;
          break;
        case PathRecordType.ClosedSubpathLength:
        case PathRecordType.OpenSubpathLength:
          // these cases might control subpath behaviors rather than draw
          // usually not directly translatable to SVG.
          break;
        case PathRecordType.PathFillRule:
          // handle fill rule if necessary, SVG has 'fill-rule' attribute.
          pathFillRule = true;
          break;
        case PathRecordType.Clipboard:
          // not directly translatable to SVG path.
          break;
        case PathRecordType.InitialFillRule:
          // manage fill rule if applicable.
          initialFillRule = record.fill;
          break;
      }
    }

    // setting the first point based on if the path is closed
    if (isClosed) {
      const firstCurve =
        firstPoint && previousPoint
          ? this.getSvgCurve(previousPoint, firstPoint, width, height)
          : "";
      svgPath = svgPath + firstCurve + "Z";
    } else {
      const firstCurve = firstPoint
        ? this.getSvgCurve(firstPoint, firstPoint, width, height)
        : "";
      svgPath = firstCurve + svgPath;
    }

    // moving to the first point
    const moveTo = firstPoint
      ? this.getSvgMoveTo(firstPoint, width, height)
      : "";
    svgPath = moveTo + svgPath;
    return svgPath;
  }

  private rotateBlock(block: number, psdLayer: Layer): void {
    const TySh = psdLayer.additionalProperties.TySh;
    if (!TySh) return;

    const angleRadians = -Math.atan2(TySh.transformYX, TySh.transformXX);
    if (angleRadians) {
      this.engine.block.setRotation(block, angleRadians);
    }
  }

  private getBlendModeFillOpacity(psdLayer: Layer): number {
    const blendOptions = psdLayer.additionalProperties["iOpa"];
    if (!blendOptions) return 255;

    const blendFillOpacity = blendOptions.fillOpacity ?? 255;
    // if the opacity is 0, we should warn the user
    if (blendFillOpacity === 0) {
      this.logger.log(
        `The fill opacity of the layer "${psdLayer.name}" was set to 0. This would make the layer invisible. We made this Layer fully visible for easier editing.`,
        "warning"
      );
      return 255;
    }
    return blendFillOpacity;
  }

  private getBlendMode(psdLayer: Layer): BlendMode | null {
    const privateLayer = psdLayer as any; // bypass type checking
    const blendMode = privateLayer.layerFrame?.layerProperties?.blendMode;
    const convertedBlendMode = webtoonToCesdkBlendMode[blendMode] ?? null;
    if (convertedBlendMode === null) {
      this.logger.log(
        `Blend mode '${blendMode}' is not supported in CE.SDK, using the default blend mode`,
        "warning"
      );
    }
    return convertedBlendMode;
  }
}
