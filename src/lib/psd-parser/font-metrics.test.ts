import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FontRenderingAdapter, type FontMetrics } from "./font-metrics";
import {
  adjustLineHeight,
  calculateVerticalAlignmentOffset,
} from "./psd-text-adjustments";
import { join } from "path";
import { pathToFileURL } from "url";

// Local test font paths (downloaded from Google Fonts)
const FIXTURES_DIR = join(import.meta.dir, "fixtures", "fonts");
const TEST_FONTS = {
  // WOFF2 format
  woff2: pathToFileURL(join(FIXTURES_DIR, "test-font.woff2")).href,
  // Standard TTF (Roboto Regular)
  ttf: pathToFileURL(join(FIXTURES_DIR, "Roboto-Regular.ttf")).href,
};

describe("FontRenderingAdapter", () => {
  let adapter: FontRenderingAdapter;

  beforeEach(() => {
    adapter = new FontRenderingAdapter();
  });

  afterEach(() => {
    adapter.clear();
  });

  describe("format detection and parsing", () => {
    it("should parse TTF fonts", async () => {
      const result = await adapter.load(TEST_FONTS.ttf);

      expect(result.metrics).not.toBeNull();
      expect(result.error).toBeUndefined();
      expect(typeof result.metrics?.ascender).toBe("number");
      expect(typeof result.metrics?.descender).toBe("number");
      expect(typeof result.metrics?.unitsPerEm).toBe("number");
    });

    it("should parse WOFF2 fonts (decompression)", async () => {
      const result = await adapter.load(TEST_FONTS.woff2);

      expect(result.metrics).not.toBeNull();
      expect(result.error).toBeUndefined();
      expect(typeof result.metrics?.ascender).toBe("number");
      expect(typeof result.metrics?.descender).toBe("number");
      expect(typeof result.metrics?.unitsPerEm).toBe("number");
    });

    it("should return FETCH_FAILED error for invalid URL", async () => {
      const result = await adapter.load("file:///nonexistent/path/font.ttf");

      expect(result.metrics).toBeNull();
      expect(result.error?.type).toBe("FETCH_FAILED");
    });

    it("should return UNSUPPORTED_FORMAT error for unknown format", async () => {
      // Use a non-font file to test format detection
      const invalidFontUrl = pathToFileURL(join(FIXTURES_DIR, "..", "invalid.txt")).href;
      const result = await adapter.load(invalidFontUrl);

      expect(result.metrics).toBeNull();
      expect(result.error?.type).toBe("UNSUPPORTED_FORMAT");
    });
  });

  describe("caching", () => {
    it("should cache metrics after loading", async () => {
      const url = TEST_FONTS.ttf;
      await adapter.load(url);

      expect(adapter.has(url)).toBe(true);
      expect(adapter.get(url)).not.toBeNull();
    });

    it("should return cached metrics on subsequent loads", async () => {
      const url = TEST_FONTS.ttf;
      const result1 = await adapter.load(url);
      const result2 = await adapter.load(url);

      expect(result1.metrics).toEqual(result2.metrics);
    });

    it("should return null for uncached fonts", () => {
      expect(adapter.has("file:///unknown/font.ttf")).toBe(false);
      expect(adapter.get("file:///unknown/font.ttf")).toBeNull();
    });

    it("should clear cache", async () => {
      const url = TEST_FONTS.ttf;
      await adapter.load(url);
      adapter.clear();

      expect(adapter.has(url)).toBe(false);
    });

    it("should cache errors for failed loads", async () => {
      const url = "file:///nonexistent/path/font.ttf";
      const result1 = await adapter.load(url);
      const result2 = await adapter.load(url);

      expect(result1.error).toBeDefined();
      expect(result2.error).toEqual(result1.error);
      expect(adapter.getError(url)).toEqual(result1.error);
    });
  });
});

describe("adjustLineHeight", () => {
  const mockMetrics: FontMetrics = {
    ascender: 1854,
    descender: -434,
    unitsPerEm: 2048,
  };

  it("should adjust line height based on font metrics", () => {
    const psdLineHeight = 1.5;
    const adjusted = adjustLineHeight(psdLineHeight, mockMetrics);

    // factor = (1854 - (-434)) / 2048 = 2288 / 2048 = 1.1171875
    // adjusted = 1.5 / 1.1171875 ≈ 1.3425
    expect(adjusted).toBeCloseTo(1.3425, 3);
  });

  it("should return same value when factor is 1", () => {
    const metricsWithFactorOne: FontMetrics = {
      ascender: 800,
      descender: -200,
      unitsPerEm: 1000,
    };
    const adjusted = adjustLineHeight(1.0, metricsWithFactorOne);

    expect(adjusted).toBeCloseTo(1.0, 5);
  });

  it("should handle various line heights", () => {
    expect(adjustLineHeight(1.0, mockMetrics)).toBeCloseTo(0.895, 2);
    expect(adjustLineHeight(2.0, mockMetrics)).toBeCloseTo(1.79, 2);
  });

  it("should return original value when unitsPerEm is 0", () => {
    const invalidMetrics: FontMetrics = {
      ascender: 1000,
      descender: -500,
      unitsPerEm: 0,
    };
    expect(adjustLineHeight(1.5, invalidMetrics)).toBe(1.5);
  });

  it("should return original value when factor is 0", () => {
    const zeroFactorMetrics: FontMetrics = {
      ascender: 0,
      descender: 0,
      unitsPerEm: 1000,
    };
    expect(adjustLineHeight(1.5, zeroFactorMetrics)).toBe(1.5);
  });
});

describe("calculateVerticalAlignmentOffset", () => {
  const mockMetrics: FontMetrics = {
    ascender: 1854,
    descender: -434,
    unitsPerEm: 2048,
  };

  it("should calculate vertical offset for baseline alignment", () => {
    const fontSize = 24;
    const offset = calculateVerticalAlignmentOffset(fontSize, mockMetrics);

    // offset = (((-(-434) + 1854 - 2048) / 2048) * 24) / 2
    // offset = ((434 + 1854 - 2048) / 2048 * 24) / 2
    // offset = (240 / 2048 * 24) / 2
    // offset = (0.1171875 * 24) / 2 = 2.8125 / 2 = 1.40625
    expect(offset).toBeCloseTo(1.406, 2);
  });

  it("should scale linearly with font size", () => {
    const offset12 = calculateVerticalAlignmentOffset(12, mockMetrics);
    const offset24 = calculateVerticalAlignmentOffset(24, mockMetrics);

    expect(offset24).toBeCloseTo(offset12 * 2, 5);
  });

  it("should return 0 when ascender equals unitsPerEm and descender is 0", () => {
    // When: -descender + ascender - unitsPerEm = 0 + 1000 - 1000 = 0
    const balancedMetrics: FontMetrics = {
      ascender: 1000,
      descender: 0,
      unitsPerEm: 1000,
    };
    const offset = calculateVerticalAlignmentOffset(24, balancedMetrics);

    expect(offset).toBeCloseTo(0, 5);
  });

  it("should return 0 when unitsPerEm is 0", () => {
    const invalidMetrics: FontMetrics = {
      ascender: 1000,
      descender: -500,
      unitsPerEm: 0,
    };
    expect(calculateVerticalAlignmentOffset(24, invalidMetrics)).toBe(0);
  });
});
