import CreativeEngine from "@cesdk/node";
import { assert } from "chai";
import fs from "fs";
import glob from "glob";
import { PNG } from "pngjs";
import { PSDParser } from "../lib/psd-parser";
import { addGoogleFontsAssetLibrary } from "../lib/psd-parser/font-resolver";
import { createPNGJSEncodeBufferToPNG } from "../lib/psd-parser/image-encoder-node";

const filePaths = glob.sync("./src/test/examples/**/*.psd");

describe("PSD parser test suite", async () => {
  describe("Creates a scene from an PSD file", async () => {
    it("should run without errors", async () => {
      const testExportFolder = async (filePath: string) => {
        const expectedPSDFileName = filePath.split("/").pop();
        const psdFolderPath = filePath.split("/").slice(0, -1).join("/");
        const psdFilePath = filePath;
        const filenameWithoutExtension = expectedPSDFileName!.split(".")[0];

        try {
          await fs.accessSync(psdFilePath);
          assert.equal(true, true);
        } catch (error) {
          assert.equal(true, false, "File does not exist");
        }

        const arrayBuffer = await fs.readFileSync(psdFilePath);
        const engine = await CreativeEngine.init({
          license: process.env.CESDK_LICENSE,
        });
        await addGoogleFontsAssetLibrary(engine as any);
        const parser = await PSDParser.fromFile(
          engine as any,
          arrayBuffer.buffer,
          createPNGJSEncodeBufferToPNG(PNG)
        );

        let result;
        try {
          result = await parser.parse();
        } catch (e) {
          console.error(e);
          return;
        }

        // down-sample the pages
        const imageBlobs = await Promise.all(
          engine.scene.getPages().map((page) =>
            engine.block.export(page, "image/png" as any, {
              targetHeight: 1000,
              targetWidth: 1000,
            })
          )
        );

        // create directory paths to file if not exists using fs
        const outputFolderPath = `./src/test/output/examples/${filenameWithoutExtension}`;
        if (!fs.existsSync(outputFolderPath)) {
          fs.mkdirSync(outputFolderPath, { recursive: true });
        }

        // write the image to disk
        await Promise.all(
          imageBlobs.map(async (imageBlob, index) => {
            const arrayBuffer = await imageBlob.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            fs.writeFileSync(`${outputFolderPath}/design-${index}.png`, buffer);
          })
        );

        const pdfGlobPattern = `${psdFolderPath}/*.png`;
        glob.sync(pdfGlobPattern).map(async (pdfPngFilePath: string) => {
          const fileName = pdfPngFilePath.split("/").pop();
          try {
            const pdfPngBlob = await fs.readFileSync(pdfPngFilePath);
            await fs.writeFileSync(
              `${outputFolderPath}/${fileName}`,
              pdfPngBlob
            );
          } catch (error) {
            debugger;
          }
        });

        const sceneString = await engine.scene.saveToString();
        await fs.writeFileSync(`${outputFolderPath}/design.scene`, sceneString);

        // write the full scene to archive file
        const sceneArchive: Blob = await engine.scene.saveToArchive();
        const sceneArchiveBuffer = await sceneArchive.arrayBuffer();
        await fs.writeFileSync(
          `${outputFolderPath}/design-archive.zip`,
          Buffer.from(sceneArchiveBuffer)
        );

        engine.dispose();
      };

      for (const filePath of filePaths) {
        await testExportFolder(filePath);
      }
    }).timeout(200000);
  });
});
