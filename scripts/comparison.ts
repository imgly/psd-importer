import * as fs from "fs";
import pixelmatch from "pixelmatch";
import * as path from "path";
import * as dotenv from "dotenv";
import Psd from "@webtoon/psd";
import { PNG } from "pngjs";
import CreativeEngine from "@cesdk/node";
import { PSDParser } from "../src/lib/psd-parser";
import { addGoogleFontsAssetLibrary } from "../src/lib/psd-parser/font-resolver";
import { createPNGJSEncodeBufferToPNG } from "../src/lib/psd-parser/image-encoder-node";

// load environment variables from .env file
dotenv.config();

// define the path to the directory containing the PSD files
const inputFolder = "src/test/examples";
const outputFolder = "src/test/output/comparison";

const MAX_EXPORT_DIMENSION = 5000;

// args can be a filter for the file paths
const args = process.argv.slice(2);
const fileNameFilter = args.length ? args[0] : null;
if (fileNameFilter) {
  console.log(`Filtering file names with: '${fileNameFilter}'`);
}

// create a map to store the number of different pixels between images
const differenceMap = new Map<string, number>();

const processPsdFiles = async (heatmap: boolean = true) => {
  // ensure output folder exists
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder);
  }

  // Read all folders in the test folder
  const folders = fs
    .readdirSync(inputFolder)
    .filter((folder) =>
      fs.lstatSync(path.join(inputFolder, folder)).isDirectory()
    );

  // initialize the engine
  const engine = await CreativeEngine.init({
    license: process.env.CESDK_LICENSE,
  });
  // add fonts
  await addGoogleFontsAssetLibrary(
    engine as any,
    "https://unpkg.com/@imgly/idml-importer@1.0.6/dist/assets/google-fonts/content.json"
  );

  for (const folder of folders) {
    if (folder === "output") continue;
    console.log("====================");
    console.log("processing folder:", folder);

    const inputFolderPath = path.join(inputFolder, folder);
    const outputFolderPath = path.join(outputFolder, folder);

    // ensure the corresponding output folder exists
    if (!fs.existsSync(outputFolderPath)) {
      fs.mkdirSync(outputFolderPath);
    }

    // read all files in the input folder
    const files = fs.readdirSync(inputFolderPath);

    for (const file of files) {
      if (fileNameFilter && !file.includes(fileNameFilter)) {
        continue;
      }
      // check if the file has a .psd extension
      if (path.extname(file).toLowerCase() === ".psd") {
        console.log("--------------------");
        console.log("processing file:", file);
        try {
          const filePath = path.join(inputFolderPath, file);
          const baseName = path.basename(file, ".psd");

          // copy original psd file to the output folder
          fs.copyFileSync(
            filePath,
            path.join(outputFolderPath, `${baseName}.psd`)
          );

          // read the PSD file and save it as PNG for reference
          const psdFileBuffer = fs.readFileSync(filePath);
          const psdFile = Psd.parse(psdFileBuffer.buffer);

          // load the PSD file to the parser
          const psd = await PSDParser.fromFile(
            engine as any,
            psdFileBuffer.buffer,
            createPNGJSEncodeBufferToPNG(PNG)
          );

          const { logger } = await psd.parse();
          const messages = logger.getMessages();
          messages.forEach((message) => {
            console.log(message);
          });

          const pages = engine.scene.getPages();
          if (!pages) {
            console.log("WARN: No pages found");
            continue;
          }

          // scale image to max 1000px height or width:
          const largerDimensionAxis =
            psdFile.width > psdFile.height ? "width" : "height";
          const largerDimensionValue = psdFile[largerDimensionAxis];
          const scale = Math.max(
            Math.min(1, MAX_EXPORT_DIMENSION / largerDimensionValue),
            0
          );
          let targetWidth, targetHeight;
          if (largerDimensionAxis === "width") {
            targetWidth = Math.round(psdFile.width * scale);
            targetHeight = Math.round(psdFile.height * scale);
          } else {
            targetWidth = Math.round(psdFile.width * scale);
            targetHeight = Math.round(psdFile.height * scale);
          }
          // export the scene with down-sampling
          const imageBlobRGBA8888 = await engine.block.export(
            pages[0],
            "application/octet-stream" as any,
            {
              targetWidth: targetWidth,
              targetHeight: targetHeight,
            }
          );
          // save the original image
          const pixelData = await psdFile.composite();
          let pixelDataBuffer = Buffer.from(pixelData);
          if (
            psdFile.width !== targetWidth ||
            psdFile.height !== targetHeight
          ) {
            pixelDataBuffer = resizeImageData(
              pixelDataBuffer,
              psdFile.width,
              psdFile.height,
              targetWidth,
              targetHeight
            );
          }
          const resizedBufferPNG = new PNG({
            width: targetWidth,
            height: targetHeight,
          });
          resizedBufferPNG.data = pixelDataBuffer;

          const resizedEncodedBuffer = PNG.sync.write(resizedBufferPNG);

          const originalPngPath = path.join(
            outputFolderPath,
            `${baseName}-original.png`
          );
          fs.writeFileSync(originalPngPath, resizedEncodedBuffer);
          console.log("saved original png:", originalPngPath);

          // save the result image
          const processedPngPath = path.join(
            outputFolderPath,
            `${baseName}-output.png`
          );
          const imageBuffer = await imageBlobRGBA8888.arrayBuffer();
          const imagePNG = new PNG({
            width: targetWidth,
            height: targetHeight,
          });
          imagePNG.data = Buffer.from(imageBuffer);
          const imageBufferPNG = PNG.sync.write(imagePNG);
          fs.writeFileSync(processedPngPath, imageBufferPNG);
          console.log("saved processed png:", processedPngPath);

          // create heatmap images
          if (heatmap) {
            const { heatmapBuffer, numDiffPixels } = createHeatmapImages(
              pixelDataBuffer,
              Buffer.from(imageBuffer),
              targetWidth,
              targetHeight
            );
            const pixelDiffRatio = numDiffPixels / (targetWidth * targetHeight);
            const heatmapPngPath = path.join(
              outputFolderPath,
              `${baseName}-heatmap.png`
            );
            fs.writeFileSync(heatmapPngPath, heatmapBuffer);
            console.log("saved heatmap png:", heatmapPngPath);
            console.log("Number of different pixels (ratio):", pixelDiffRatio);
            differenceMap.set(heatmapPngPath, pixelDiffRatio);
          }

          // write the full scene to an archive file
          const designArchivePath = path.join(
            outputFolderPath,
            `${baseName}-design-archive.zip`
          );
          const sceneArchive: Blob = await engine.scene.saveToArchive();
          const sceneArchiveBuffer = await sceneArchive.arrayBuffer();
          fs.writeFileSync(designArchivePath, Buffer.from(sceneArchiveBuffer));
        } catch (err) {
          console.log("ERROR:", err);
        }
      }

      // clean up large buffers to free memory
      await global.gc?.();
    }
    // clean up large buffers to free memory
    await global.gc?.();
  }

  console.log("====================");
  console.log("Results (File/Difference in %):");
  const sortedDifferenceMap = new Map(
    [...differenceMap.entries()].sort((a, b) => b[1] - a[1])
  );
  for (const [file, numDiffPixels] of sortedDifferenceMap) {
    console.log(file, ":", numDiffPixels);
  }
  engine.dispose();
};

// function to generate heatmap images from the comparison using pixelmatch
function createHeatmapImages(
  originalImageBuffer: Buffer,
  processedImageBuffer: Buffer,
  width: number,
  height: number
) {
  // create PNG objects for the original and processed images
  const originalPng = new PNG({ width, height });
  const processedPng = new PNG({ width, height });

  // copy the raw buffer data to the PNG objects
  originalPng.data = originalImageBuffer;
  processedPng.data = processedImageBuffer;

  // create a new PNG object for the heatmap
  const heatmapPng = new PNG({ width, height });

  // create a heatmap image using pixelmatch
  const numDiffPixels = pixelmatch(
    originalPng.data,
    processedPng.data,
    heatmapPng.data,
    width,
    height,
    { threshold: 0.1 }
  );

  // encode the heatmap PNG to a buffer
  const heatmapBuffer = PNG.sync.write(heatmapPng);

  return { heatmapBuffer, numDiffPixels };
}

// resize raw image buffer without pngjs
function resizeImageData(
  imageBuffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  newWidth: number,
  newHeight: number
) {
  const scaleFactor = Math.min(newWidth / imageWidth, newHeight / imageHeight);
  const resizedBuffer = Buffer.alloc(newWidth * newHeight * 4);

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.floor(x / scaleFactor);
      const srcY = Math.floor(y / scaleFactor);

      const srcIdx = (srcY * imageWidth + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;

      resizedBuffer[dstIdx] = imageBuffer[srcIdx];
      resizedBuffer[dstIdx + 1] = imageBuffer[srcIdx + 1];
      resizedBuffer[dstIdx + 2] = imageBuffer[srcIdx + 2];
      resizedBuffer[dstIdx + 3] = imageBuffer[srcIdx + 3];
    }
  }

  return resizedBuffer;
}

// Run the function to process PSD files
processPsdFiles(true)
  .then(() => console.log("====================\nProcessing complete!"))
  .catch(console.error);
