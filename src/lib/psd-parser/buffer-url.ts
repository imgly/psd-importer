import type CreativeEngine from "@cesdk/engine";

/**
 * Creates an internal buffer URI from a Blob.
 * Drop-in replacement for URL.createObjectURL() that uses CE.SDK internal buffers.
 *
 * Using internal buffers instead of blob URLs enables CE.SDK's native
 * transient resource management APIs:
 * - `findAllTransientResources()` will detect these buffers
 * - `getBufferData()` can extract the binary data
 * - `relocateResource()` can update URLs after upload
 *
 * Usage:
 * ```typescript
 * // Instead of:
 * const imageURI = URL.createObjectURL(imgBlob);
 *
 * // Use:
 * const imageURI = await createBufferURL(engine, imgBlob);
 * ```
 *
 * @param engine - The CE.SDK engine instance
 * @param blob - The Blob to store in the buffer
 * @returns A buffer:// URI that can be used as imageFileURI
 */
export async function createBufferURL(
  engine: CreativeEngine,
  blob: Blob
): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const bufferUri = engine.editor.createBuffer();
  engine.editor.setBufferLength(bufferUri, data.length);
  engine.editor.setBufferData(bufferUri, 0, data);

  return bufferUri;
}
