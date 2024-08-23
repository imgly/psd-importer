# Photoshop Importer for the CE.SDK

## Overview

The Photoshop Importer for the CE.SDK allows you to seamlessly integrate Photoshop files into the editor while retaining essential design attributes.

Here’s an overview of the main features:

- _File Format Translation_: The importer converts **PSD files** from Adobe Photoshop into the CE.SDK scene file format. The resulting scene archive includes all required assets for immediate use.
- _Bulk Importing_: The codebase is adaptable for bulk importing, streamlining large-scale projects.

The following Photoshop design elements will be preserved by the import:

- _Element grouping_: grouped elements will be preserved if possible and enabled.
- _Positioning and Rotation_: Elements’ positioning and rotation are accurately transferred.
- _Image Elements_: Images are supported, while image cropping is not yet available.
- _Text Elements_: Font family continuity is maintained, with options to supply font URIs or use Google fonts. Only bold and italic styles are currently supported.
- _Shapes_: Rect, Oval, Polygon, and Line shapes are supported, along with custom shapes that might experience minor distortion.
- _Colors and Strokes_: Solid colors, stroke weight, color, and alignment are faithfully reproduced. Gradient fills are not yet supported.
- _Transparency_: Transparency is preserved for seamless integration.

This Photoshop Importer bridges the gap between Photoshop files and CE.SDK scenes, enabling efficient transitions while retaining crucial design details. Your input is invaluable as we continue to refine and improve the importer’s capabilities.

## Installation

You can install `@imgly/psd-importer` via npm or yarn. Use the following commands to install the package:

```shell
npm install @imgly/psd-importer
yarn add @imgly/psd-importer
```

## Browser Quick-Start Example

```js
import CreativeEngine from "@cesdk/engine";
import { PSDParser, createWebEncodeBufferToPNG } from "@imgly/psd-importer";

const blob = await fetch(
  "https://img.ly/showcases/cesdk/cases/photoshop-template-import/socialmedia.psd"
).then((res) => res.blob());
const buffer = await blob.arrayBuffer();
const engine = await CreativeEngine.init({
  license: "YOUR_LICENSE",
});
const parser = await PSDParser.fromFile(
  engine,
  buffer,
  createWebEncodeBufferToPNG()
);

await parser.parse();

const image = await engine.block.export(
  engine.block.findByType("//ly.img.ubq/page")[0],
  "image/png"
);
const sceneExportUrl = window.URL.createObjectURL(image);
console.log("The imported PSD file looks like:", sceneExportUrl);
// You can now e.g export the scene as archive with engine.scene.saveToArchive()
```

## NodeJS Quick-Start Example

Here is a sample code for using the psd-importer in NodeJS.

```js
// index.mjs
// We currently only support ES Modules in NodeJS
import CreativeEngine from "@cesdk/node";
import { promises as fs } from "fs";
import { PNG } from "pngjs";
import { PSDParser, createPNGJSEncodeBufferToPNG } from "@imgly/psd-importer";

async function main() {
  const engine = await CreativeEngine.init({
    license: "YOUR_LICENSE",
  });

  const psdSampleUrl =
    "https://img.ly/showcases/cesdk/cases/photoshop-template-import/socialmedia.psd";
  const psdSample = await fetch(psdSampleUrl).then((res) => res.blob());
  const psdSampleBuffer = await psdSample.arrayBuffer();
  const parser = await PSDParser.fromFile(
    engine,
    psdSampleBuffer,
    createPNGJSEncodeBufferToPNG(PNG)
  );
  await parser.parse();

  const image = await engine.block.export(
    engine.block.findByType("//ly.img.ubq/page")[0],
    "image/png"
  );
  const imageBuffer = await image.arrayBuffer();
  await fs.writeFile("./example.png", Buffer.from(imageBuffer));

  engine.dispose();
}
main();
```

## Current Limitations

The following features are either not supported by our engine yet or have limited support:

#### Limitations

Descriptions of specific limitations in areas such as group handling and text formatting:

- Support for Groups is limited, especially for groups with single members.
- Multiple font sizes within different parts of a text layer are not supported.
- Using multiple font families within a single text layer is not supported.
- Text justification is not supported.

#### Unsupported Style Sheet Features:

Details on the unsupported advanced text styling and formatting features:

- Diacritic Positioning: Adjusting the position of diacritical marks.
- Kashida Length: Customizing the length of Kashida in Arabic scripts.
- Hindi Numerals: Enabling or disabling the use of Hindi numerals.
- Character Direction: Setting the text direction (e.g., left-to-right, right-to-left).
- Underline Positioning: Adjusting the vertical position of the underline.
- Fill and Stroke Order: Determining whether the fill is applied before the stroke.
- No-Break Text: Preventing line breaks within the text.
- Character Spacing Adjustment (Tsume): Adjusting spacing between characters.
- Baseline Direction: Setting the direction of the text baseline (horizontal or vertical).
- Discretionary Ligatures: Enabling or disabling discretionary ligatures.
- Standard Ligatures: Enabling or disabling standard ligatures.
- Strikethrough: Applying a strikethrough to the text.
- Underline: Applying an underline to the text.
- Font Baseline Positioning: Adjusting the baseline position of the font.
- Baseline Shift: Vertically shifting the text baseline.
- Kerning: Adjusting spacing between specific pairs of characters.
- Automatic Kerning: Enabling or disabling automatic kerning.
- Automatic Leading: Enabling or disabling automatic line spacing.

#### Unsupported Paragraph Features:

An outline of the unsupported paragraph-level formatting and alignment options:

- Every Line Composer: Optimizes line breaks across the entire paragraph for better text flow.
- Kinsoku Shori Order: Customizes character handling for Japanese text at line ends.
- Hanging Punctuation: Allows punctuation to hang outside text margins for improved alignment.
- Auto Leading: Automatically adjusts line spacing based on font size.
- Glyph Spacing: Adjusts spacing between individual glyphs.
- Word Spacing: Adjusts spacing between words.
- Paragraph Zone: Controls alignment and indentation relative to the text frame.
- Consecutive Hyphens Limit: Sets the maximum number of consecutive hyphens allowed.
- Hyphenation Control: Specifies the minimum number of characters before and after a hyphen in hyphenated words.
- Minimum Hyphenated Word Size: Defines the minimum length of a word that can be hyphenated.
- Automatic Hyphenation: Enables or disables automatic hyphenation.
- Space Adjustment: Adds space before and after paragraphs.
- Paragraph Indentation: Customizes indentation for the start, end, and first line of paragraphs.

#### Unsupported Blend Modes:

List of blend modes not currently supported by the engine:

- PassThrough
- Dissolve
- LinearBurn
- DarkerColor
- LinearDodge
- LighterColor
- VividLight
- LinearLight
- PinLight
- HardMix
- Subtract
- Divide
