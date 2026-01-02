/**
 * Test: Transient Resource Relocation
 *
 * This test validates the workflow for persisting PSD-imported assets.
 *
 * The PSD parser now uses CE.SDK internal buffers (via `createBufferURL()`)
 * instead of `URL.createObjectURL()`. This enables CE.SDK's native APIs:
 *
 * 1. Parse a PSD file (creates buffer:// URLs for images)
 * 2. Use `findAllTransientResources()` to find all PSD-imported assets
 * 3. Use `getBufferData()` to extract the binary data
 * 4. Upload to backend / save to disk
 * 5. Use `relocateResource()` to update URLs to permanent locations
 * 6. Save scene to string (now contains permanent URLs)
 * 7. Scene can be reloaded in a fresh engine
 */

import * as dotenv from "dotenv";
dotenv.config();

import CreativeEngine from "@cesdk/node";
import { assert } from "chai";
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { PSDParser } from "../lib/psd-parser";
import { addGoogleFontsAssetLibrary } from "../lib/psd-parser/font-resolver";
import { createPNGJSEncodeBufferToPNG } from "../lib/psd-parser/image-encoder-node";

describe("Transient Resource Relocation", () => {
  // Use a PSD file with image layers to test transient resource handling
  const testPsdPath = "./src/test/examples/single-background/test3-with-layer.psd";
  const outputDir = "./src/test/output/transient-relocation-test";
  const assetsDir = path.join(outputDir, "assets");

  before(() => {
    // Clean up and create output directories
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(assetsDir, { recursive: true });
  });

  it("should relocate transient resources to file URLs and reload scene successfully", async () => {
    // =========================================================================
    // PHASE 1: Parse PSD and extract transient resources
    // =========================================================================

    const psdBuffer = fs.readFileSync(testPsdPath);

    let engine = await CreativeEngine.init({
      license: process.env.CESDK_LICENSE,
    });

    try {
      await addGoogleFontsAssetLibrary(engine as any);

      const parser = await PSDParser.fromFile(
        engine as any,
        psdBuffer.buffer,
        createPNGJSEncodeBufferToPNG(PNG)
      );

      const { scene } = await parser.parse();
      assert.isNumber(scene, "Scene should be created");

      // =========================================================================
      // PHASE 2: Find and relocate using CE.SDK native APIs
      // =========================================================================

      // With internal buffers, findAllTransientResources now works!
      const transientResources = engine.editor.findAllTransientResources();
      console.log(`CE.SDK findAllTransientResources() found: ${transientResources.length} transient resource(s)`);
      assert.isAbove(transientResources.length, 0, "Should find transient resources from PSD import");

      const relocationMap: Map<string, string> = new Map();

      for (let i = 0; i < transientResources.length; i++) {
        const resource = transientResources[i] as any;
        const uri = resource.uri || resource.url || resource.URL;
        const size = resource.size;

        console.log(`Processing resource ${i + 1}/${transientResources.length}: ${uri} (${size} bytes)`);

        // Extract binary data using CE.SDK native API
        const data = engine.editor.getBufferData(uri, 0, size);

        // Determine file path
        const filename = `asset-${i}.png`;
        const filePath = path.join(assetsDir, filename);
        const absoluteFilePath = path.resolve(filePath);

        // Write to disk
        fs.writeFileSync(filePath, Buffer.from(data));
        console.log(`  Saved to: ${filePath} (${data.length} bytes)`);

        // Create file:// URL for the relocated resource
        const fileUrl = `file://${absoluteFilePath}`;
        relocationMap.set(uri, fileUrl);

        // Relocate using CE.SDK native API
        engine.editor.relocateResource(uri, fileUrl);
        console.log(`  Relocated to: ${fileUrl}`);
      }

      console.log(`Relocated ${transientResources.length} transient resource(s)`);

      // =========================================================================
      // PHASE 3: Save scene to string (should now contain file:// URLs)
      // =========================================================================

      const sceneString = await engine.scene.saveToString();
      const sceneFilePath = path.join(outputDir, "scene.json");
      fs.writeFileSync(sceneFilePath, sceneString);
      console.log(`Scene saved to: ${sceneFilePath}`);

      // The scene string is base64 encoded, decode it for verification
      const decodedScene = Buffer.from(sceneString, "base64").toString("utf-8");

      // Verify scene string contains file:// URLs, not buffer:// URLs
      assert.notInclude(decodedScene, "buffer://", "Scene should not contain buffer:// URLs after relocation");

      // Check that at least some file:// URLs are present if we had transient resources
      if (transientResources.length > 0) {
        assert.include(decodedScene, "file://", "Scene should contain file:// URLs after relocation");
        console.log(`Verified: Scene contains file:// URLs for ${transientResources.length} relocated resource(s)`);
      }

      // Export a reference image before disposing
      const pages = engine.scene.getPages();
      if (pages.length > 0) {
        const referenceBlob = await engine.block.export(pages[0], "image/png" as any, {
          targetWidth: 500,
          targetHeight: 500,
        });
        const referenceBuffer = Buffer.from(await referenceBlob.arrayBuffer());
        fs.writeFileSync(path.join(outputDir, "reference-before-reload.png"), referenceBuffer);
      }

      // Dispose first engine
      engine.dispose();

      // =========================================================================
      // PHASE 4: Create fresh engine and load scene from string
      // =========================================================================

      console.log("\n--- Creating fresh engine and loading scene ---\n");

      engine = await CreativeEngine.init({
        license: process.env.CESDK_LICENSE,
      });

      // Load the scene from the saved string
      const loadedSceneString = fs.readFileSync(sceneFilePath, "utf-8");
      const loadedScene = await engine.scene.loadFromString(loadedSceneString);

      assert.isNumber(loadedScene, "Loaded scene should be valid");
      console.log(`Scene loaded successfully: ${loadedScene}`);

      // =========================================================================
      // PHASE 5: Verify the loaded scene works correctly
      // =========================================================================

      const loadedPages = engine.scene.getPages();
      assert.isAbove(loadedPages.length, 0, "Loaded scene should have at least one page");
      console.log(`Loaded scene has ${loadedPages.length} page(s)`);

      // Try to export the loaded scene to verify assets load correctly
      const exportedBlob = await engine.block.export(loadedPages[0], "image/png" as any, {
        targetWidth: 500,
        targetHeight: 500,
      });

      assert.isNotNull(exportedBlob, "Should be able to export loaded scene");

      const exportedBuffer = Buffer.from(await exportedBlob.arrayBuffer());
      fs.writeFileSync(path.join(outputDir, "exported-after-reload.png"), exportedBuffer);
      console.log("Successfully exported loaded scene to PNG");

      // Verify the exported image has content (not empty/black)
      assert.isAbove(exportedBuffer.length, 1000, "Exported image should have substantial content");

    } finally {
      engine.dispose();
    }
  }).timeout(60000);

  it("should handle scenes with no transient resources gracefully", async () => {
    const engine = await CreativeEngine.init({
      license: process.env.CESDK_LICENSE,
    });

    try {
      // Create an empty scene
      engine.scene.create();

      const transientResources = engine.editor.findAllTransientResources();
      assert.equal(transientResources.length, 0, "Empty scene should have no transient resources");

      const sceneString = await engine.scene.saveToString();
      assert.isString(sceneString, "Should be able to save empty scene");

    } finally {
      engine.dispose();
    }
  }).timeout(30000);

  it("should detect internal buffers with findAllTransientResources (proof of concept)", async () => {
    // This test proves that if PSD parser used createBuffer() instead of URL.createObjectURL(),
    // the CE.SDK native APIs would work for transient resource management.

    const engine = await CreativeEngine.init({
      license: process.env.CESDK_LICENSE,
    });

    try {
      engine.scene.create();
      const page = engine.block.create("//ly.img.ubq/page");
      engine.block.appendChild(engine.scene.get()!, page);

      // Create an internal buffer (like PSD parser could do)
      const bufferUri = engine.editor.createBuffer();

      // Create some fake PNG data (minimal valid PNG header + IEND)
      const fakePngData = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, // IHDR length
        0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, // width: 1
        0x00, 0x00, 0x00, 0x01, // height: 1
        0x08, 0x02, // bit depth: 8, color type: RGB
        0x00, 0x00, 0x00, // compression, filter, interlace
        0x90, 0x77, 0x53, 0xDE, // CRC
        0x00, 0x00, 0x00, 0x0C, // IDAT length
        0x49, 0x44, 0x41, 0x54, // IDAT
        0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0xFF, 0x00, // compressed data
        0x05, 0xFE, 0x02, 0xFE, // CRC
        0x00, 0x00, 0x00, 0x00, // IEND length
        0x49, 0x45, 0x4E, 0x44, // IEND
        0xAE, 0x42, 0x60, 0x82, // CRC
      ]);

      engine.editor.setBufferLength(bufferUri, fakePngData.length);
      engine.editor.setBufferData(bufferUri, 0, fakePngData);

      // Create an image block using this buffer
      const imageBlock = engine.block.create("//ly.img.ubq/graphic");
      const fillType = engine.block.createFill("//ly.img.ubq/fill/image");
      engine.block.setFill(imageBlock, fillType);
      engine.block.setString(fillType, "fill/image/imageFileURI", bufferUri);
      engine.block.appendChild(page, imageBlock);

      // NOW findAllTransientResources should detect this buffer!
      const transientResources = engine.editor.findAllTransientResources();
      console.log(`findAllTransientResources() with internal buffer: ${transientResources.length}`);
      console.log(`Transient resource:`, JSON.stringify(transientResources[0]));

      assert.equal(transientResources.length, 1, "Internal buffer should be detected as transient resource");

      // The API returns { URL, size } (uppercase URL)
      const resource = transientResources[0] as any;
      const resourceUri = resource.uri || resource.url || resource.URL;
      assert.equal(resourceUri, bufferUri, "Transient resource URI should match buffer URI");
      assert.equal(resource.size, fakePngData.length, "Transient resource size should match buffer size");

      console.log("SUCCESS: Using internal buffers makes findAllTransientResources() work!");

    } finally {
      engine.dispose();
    }
  }).timeout(30000);

  it("should work with createBufferURL for full relocation flow", async () => {
    // This test demonstrates that using createBufferURL instead of URL.createObjectURL()
    // enables the CE.SDK native transient resource APIs to work seamlessly.

    const { createBufferURL } = await import("../lib/psd-parser/buffer-url");

    const engine = await CreativeEngine.init({
      license: process.env.CESDK_LICENSE,
    });

    try {
      engine.scene.create();
      const page = engine.block.create("//ly.img.ubq/page");
      engine.block.appendChild(engine.scene.get()!, page);
      engine.block.setWidth(page, 100);
      engine.block.setHeight(page, 100);

      // Create a real PNG blob (1x1 red pixel)
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xFE,
        0xD4, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
        0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);
      const imgBlob = new Blob([pngData], { type: "image/png" });

      // Use createBufferURL instead of URL.createObjectURL()
      const imageURI = await createBufferURL(engine as any, imgBlob);
      console.log(`Created buffer URI: ${imageURI}`);

      // Create an image block using this buffer
      const imageBlock = engine.block.create("//ly.img.ubq/graphic");
      const rectFrame = engine.block.createShape("//ly.img.ubq/shape/rect");
      const fillType = engine.block.createFill("//ly.img.ubq/fill/image");
      engine.block.setShape(imageBlock, rectFrame);
      engine.block.setFill(imageBlock, fillType);
      engine.block.setString(fillType, "fill/image/imageFileURI", imageURI);
      engine.block.appendChild(page, imageBlock);
      engine.block.setWidth(imageBlock, 50);
      engine.block.setHeight(imageBlock, 50);

      // Verify findAllTransientResources detects the buffer
      const transientResources = engine.editor.findAllTransientResources();
      console.log(`findAllTransientResources() found: ${transientResources.length}`);
      assert.equal(transientResources.length, 1, "Should detect buffer as transient resource");

      // Now use the native CE.SDK API to relocate
      const resource = transientResources[0] as any;
      const resourceUri = resource.uri || resource.url || resource.URL;
      const resourceSize = resource.size;

      // Extract data using CE.SDK native API
      const data = engine.editor.getBufferData(resourceUri, 0, resourceSize);

      // Save to file
      const filename = `buffer-test-asset.png`;
      const filePath = path.join(assetsDir, filename);
      const absoluteFilePath = path.resolve(filePath);
      fs.writeFileSync(filePath, Buffer.from(data));
      console.log(`Saved to: ${filePath} (${data.length} bytes)`);

      // Relocate using CE.SDK native API
      const fileUrl = `file://${absoluteFilePath}`;
      engine.editor.relocateResource(resourceUri, fileUrl);
      console.log(`Relocated to: ${fileUrl}`);

      // Verify the relocation was applied
      const updatedUri = engine.block.getString(fillType, "fill/image/imageFileURI");
      console.log(`Updated imageFileURI: ${updatedUri}`);
      assert.equal(updatedUri, fileUrl, "Block URI should be updated to file URL");

      // Note: findAllTransientResources still returns the buffer because the buffer still exists
      // The relocation just updates references to use the new URL
      // In a real scenario, you might want to destroy the buffer after relocation
      const remainingTransient = engine.editor.findAllTransientResources();
      console.log(`Remaining transient resources: ${remainingTransient.length}`);

      // Save and reload scene
      const sceneString = await engine.scene.saveToString();
      const decodedScene = Buffer.from(sceneString, "base64").toString("utf-8");
      assert.include(decodedScene, "file://", "Scene should contain file:// URLs");
      assert.notInclude(decodedScene, "buffer://", "Scene should not contain buffer:// URLs after relocation");

      console.log("SUCCESS: createBufferURL enables native CE.SDK transient resource management!");

    } finally {
      engine.dispose();
    }
  }).timeout(30000);

  it("should preserve asset quality after relocation round-trip", async () => {
    const psdBuffer = fs.readFileSync(testPsdPath);

    let engine = await CreativeEngine.init({
      license: process.env.CESDK_LICENSE,
    });

    try {
      await addGoogleFontsAssetLibrary(engine as any);

      const parser = await PSDParser.fromFile(
        engine as any,
        psdBuffer.buffer,
        createPNGJSEncodeBufferToPNG(PNG)
      );

      await parser.parse();

      // Get transient resources and their sizes
      const transientResources = engine.editor.findAllTransientResources();
      const originalSizes = transientResources.map(r => r.size);

      // Relocate all resources
      for (let i = 0; i < transientResources.length; i++) {
        const resource = transientResources[i] as any;
        const uri = resource.uri || resource.url || resource.URL;
        const data = engine.editor.getBufferData(uri, 0, resource.size);

        const filename = `quality-test-asset-${i}.png`;
        const filePath = path.join(assetsDir, filename);
        const absoluteFilePath = path.resolve(filePath);

        fs.writeFileSync(filePath, Buffer.from(data));

        // Verify file size matches original buffer size
        const fileStats = fs.statSync(filePath);
        assert.equal(
          fileStats.size,
          originalSizes[i],
          `Asset ${i} file size should match original buffer size`
        );

        engine.editor.relocateResource(uri, `file://${absoluteFilePath}`);
      }

      console.log(`Verified ${transientResources.length} assets preserved their size after relocation`);

    } finally {
      engine.dispose();
    }
  }).timeout(60000);
});

/**
 * Utility function for Node.js environments that relocates PSD-imported assets
 * to file:// URLs on disk using CE.SDK native APIs.
 *
 * Example usage:
 * ```typescript
 * const parser = await PSDParser.fromFile(engine, psdBuffer, encoder);
 * await parser.parse();
 * await relocateTransientResourcesToFiles(engine, './assets');
 * const sceneJson = await engine.scene.saveToString();
 * ```
 */
export async function relocateTransientResourcesToFiles(
  engine: InstanceType<typeof CreativeEngine>,
  outputDir: string
): Promise<Map<string, string>> {
  const relocationMap = new Map<string, string>();

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const transientResources = engine.editor.findAllTransientResources();

  for (let i = 0; i < transientResources.length; i++) {
    const resource = transientResources[i] as any;
    const uri = resource.uri || resource.url || resource.URL;
    const size = resource.size;

    // Extract binary data using CE.SDK native API
    const data = engine.editor.getBufferData(uri, 0, size);

    const filename = `asset-${i}-${Date.now()}.png`;
    const filePath = path.join(outputDir, filename);
    const absoluteFilePath = path.resolve(filePath);

    fs.writeFileSync(filePath, Buffer.from(data));

    const fileUrl = `file://${absoluteFilePath}`;
    relocationMap.set(uri, fileUrl);

    engine.editor.relocateResource(uri, fileUrl);
  }

  return relocationMap;
}

/**
 * Utility function for web environments that uploads PSD-imported assets
 * to a backend and replaces them with permanent URLs using CE.SDK native APIs.
 *
 * Example usage:
 * ```typescript
 * const parser = await PSDParser.fromFile(engine, psdBuffer, encoder);
 * await parser.parse();
 * await relocateTransientResourcesToBackend(engine, async (data, index, uri) => {
 *   const formData = new FormData();
 *   formData.append('file', new Blob([data], { type: 'image/png' }));
 *   const response = await fetch('/api/upload', { method: 'POST', body: formData });
 *   const { url } = await response.json();
 *   return url;
 * });
 * const sceneJson = await engine.scene.saveToString();
 * ```
 */
export async function relocateTransientResourcesToBackend(
  engine: InstanceType<typeof CreativeEngine>,
  uploadFn: (data: Uint8Array, index: number, originalUri: string) => Promise<string>
): Promise<Map<string, string>> {
  const relocationMap = new Map<string, string>();
  const transientResources = engine.editor.findAllTransientResources();

  // Process uploads in parallel for better performance
  const uploadPromises = transientResources.map(async (resource, index) => {
    const res = resource as any;
    const uri = res.uri || res.url || res.URL;
    const size = res.size;

    // Extract binary data using CE.SDK native API
    const data = engine.editor.getBufferData(uri, 0, size);

    const permanentUrl = await uploadFn(data, index, uri);
    relocationMap.set(uri, permanentUrl);

    engine.editor.relocateResource(uri, permanentUrl);
  });

  await Promise.all(uploadPromises);

  return relocationMap;
}
