/**
 * Font Metrics Extraction Module
 *
 * This module provides functionality to extract font metrics (ascender, descender,
 * unitsPerEm) from font files. These metrics are essential for accurate text
 * positioning when importing PSD files into CE.SDK.
 *
 * Supported formats: TTF, OTF, WOFF, WOFF2
 *
 * Usage:
 * ```typescript
 * import { FontRenderingAdapter } from './font-metrics';
 *
 * const adapter = new FontRenderingAdapter();
 *
 * // Load metrics from a font URL (fetches, parses, and caches automatically)
 * const result = await adapter.load('https://fonts.example.com/Roboto-Regular.ttf');
 * if (result.metrics) {
 *   console.log('Ascender:', result.metrics.ascender);
 *   console.log('Descender:', result.metrics.descender);
 *   console.log('Units per Em:', result.metrics.unitsPerEm);
 * } else {
 *   console.error('Failed to load font:', result.error?.message);
 * }
 *
 * // Check if metrics are cached
 * if (adapter.has(fontURI)) {
 *   const metrics = adapter.get(fontURI);
 * }
 *
 * // Clear cache when done
 * adapter.clear();
 * ```
 *
 * For PSD-specific text adjustments, see `psd-text-adjustments.ts`.
 */

// @ts-ignore
import opentype from "opentype.js";

export interface FontMetrics {
  ascender: number;
  descender: number;
  unitsPerEm: number;
}

export type FontParseErrorType =
  | "FETCH_FAILED"
  | "UNSUPPORTED_FORMAT"
  | "PARSE_FAILED"
  | "WOFF2_DECOMPRESS_FAILED";

export interface FontParseError {
  type: FontParseErrorType;
  message: string;
}

export interface FontLoadResult {
  metrics: FontMetrics | null;
  error?: FontParseError;
}

type FontFormat = "ttf" | "otf" | "woff" | "woff2" | "unknown";

function getFontFormat(buffer: ArrayBuffer): FontFormat {
  const b = new Uint8Array(buffer);
  if (b.length < 4) return "unknown";
  if (b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32)
    return "woff2";
  if (b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x46)
    return "woff";
  if (
    (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) ||
    (b[0] === 0x74 && b[1] === 0x72 && b[2] === 0x75 && b[3] === 0x65)
  )
    return "ttf";
  if (b[0] === 0x4f && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4f)
    return "otf";
  return "unknown";
}

/**
 * Decompresses a font buffer if needed (e.g., WOFF2 → TTF).
 * Uses dynamic import to lazily load woff2-encoder only when needed.
 */
async function decompressFontBuffer(
  buffer: ArrayBuffer,
  format: FontFormat
): Promise<ArrayBuffer> {
  if (format === "woff2") {
    const { default: decompress } = await import("woff2-encoder/decompress");
    const result = await decompress(buffer);
    return result.buffer as ArrayBuffer;
  }
  return buffer;
}

/**
 * Font metrics storage with built-in loading from URLs.
 * Handles fetching, format detection, parsing, and caching.
 */
export class FontRenderingAdapter {
  private cache: Map<string, FontMetrics> = new Map();

  /** Check if metrics are already loaded for a font */
  has(fontURI: string): boolean {
    return this.cache.has(fontURI);
  }

  /** Get cached metrics (returns null if not loaded) */
  get(fontURI: string): FontMetrics | null {
    return this.cache.get(fontURI) ?? null;
  }

  /**
   * Load font metrics from URL. Fetches, detects format, parses, and caches.
   * Returns cached metrics if already loaded.
   */
  async load(fontURI: string): Promise<FontLoadResult> {
    const cached = this.cache.get(fontURI);
    if (cached) return { metrics: cached };

    // Fetch
    let buffer: ArrayBuffer;
    try {
      const res = await fetch(fontURI);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffer = await res.arrayBuffer();
    } catch (e) {
      return {
        metrics: null,
        error: { type: "FETCH_FAILED", message: String(e) },
      };
    }

    // Detect format
    const format = getFontFormat(buffer);
    if (format === "unknown") {
      return {
        metrics: null,
        error: { type: "UNSUPPORTED_FORMAT", message: "Unknown font format" },
      };
    }
    // Decompress if needed (WOFF2 → TTF)
    try {
      buffer = await decompressFontBuffer(buffer, format);
    } catch (e) {
      return {
        metrics: null,
        error: {
          type: "WOFF2_DECOMPRESS_FAILED",
          message: String(e),
        },
      };
    }

    // Parse
    try {
      const font = opentype.parse(buffer);
      const { ascender, descender, unitsPerEm } = font;
      if (
        typeof ascender !== "number" ||
        typeof descender !== "number" ||
        typeof unitsPerEm !== "number"
      ) {
        throw new Error("Missing metrics");
      }
      const metrics: FontMetrics = { ascender, descender, unitsPerEm };
      this.cache.set(fontURI, metrics);
      return { metrics };
    } catch (e) {
      return {
        metrics: null,
        error: { type: "PARSE_FAILED", message: String(e) },
      };
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
