import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FontRenderingAdapter, type FontMetrics } from "./font-metrics";
import {
  adjustLineHeight,
  calculateVerticalAlignmentOffset,
} from "./psd-text-adjustments";

// Test font URLs
const TEST_FONTS = {
  // WOFF2 from the customer ticket
  woff2: "https://fonts.gstatic.com/l/font?kit=q5uDsoS_Lf9xv7Su1Fp4ATRZs5RwX6vAwjD_YUY1VtRJL6DJ&skey=f367a5978ad3b244&v=v5",
  // Standard TTF (Google Fonts Roboto)
  ttf: "https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5Q.ttf",
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

    it("should return error for invalid URL", async () => {
      const result = await adapter.load("https://example.com/nonexistent.ttf");

      expect(result.metrics).toBeNull();
      expect(result.error?.type).toBe("FETCH_FAILED");
    });

    it("should return error for unknown format", async () => {
      // Create a mock server response would be complex, so we test the error type exists
      const result = await adapter.load("data:application/octet-stream;base64,AAAA");

      expect(result.metrics).toBeNull();
      // Could be FETCH_FAILED or UNSUPPORTED_FORMAT depending on how data URLs are handled
      expect(result.error).toBeDefined();
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
      expect(adapter.has("https://example.com/unknown.ttf")).toBe(false);
      expect(adapter.get("https://example.com/unknown.ttf")).toBeNull();
    });

    it("should clear cache", async () => {
      const url = TEST_FONTS.ttf;
      await adapter.load(url);
      adapter.clear();

      expect(adapter.has(url)).toBe(false);
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

  it("should return 0 when metrics are balanced", () => {
    const balancedMetrics: FontMetrics = {
      ascender: 1000,
      descender: 0,
      unitsPerEm: 1000,
    };
    const offset = calculateVerticalAlignmentOffset(24, balancedMetrics);

    expect(offset).toBeCloseTo(0, 5);
  });
});
