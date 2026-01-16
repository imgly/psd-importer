import { describe, it, expect } from "bun:test";
import {
  extractRotationFromTransformMatrix,
  hasSkewTransform,
} from "./transform";

describe("extractRotationFromTransformMatrix", () => {
  it("should return null for identity matrix (no rotation)", () => {
    const result = extractRotationFromTransformMatrix(1, 0, 0, 1);
    expect(result).toBeNull();
  });

  it("should extract 90 degree rotation", () => {
    // 90° rotation: cos(90°)=0, sin(90°)=1
    // XX=0, XY=-1, YX=1, YY=0
    const result = extractRotationFromTransformMatrix(0, -1, 1, 0);
    expect(result).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("should extract 45 degree rotation", () => {
    const cos45 = Math.cos(Math.PI / 4);
    const sin45 = Math.sin(Math.PI / 4);
    // XX=cos, XY=-sin, YX=sin, YY=cos
    const result = extractRotationFromTransformMatrix(
      cos45,
      -sin45,
      sin45,
      cos45
    );
    expect(result).toBeCloseTo(-Math.PI / 4, 5);
  });

  it("should extract rotation with uniform scale", () => {
    const scale = 2;
    const cos45 = Math.cos(Math.PI / 4);
    const sin45 = Math.sin(Math.PI / 4);
    const result = extractRotationFromTransformMatrix(
      scale * cos45,
      scale * -sin45,
      scale * sin45,
      scale * cos45
    );
    expect(result).toBeCloseTo(-Math.PI / 4, 5);
  });

  it("should return null for skew/shear transform", () => {
    // Horizontal skew: XX=1, XY=0.5, YX=0, YY=1
    const result = extractRotationFromTransformMatrix(1, 0.5, 0, 1);
    expect(result).toBeNull();
  });

  it("should return null for non-uniform scale without rotation", () => {
    // ScaleX=2, ScaleY=1, no rotation
    const result = extractRotationFromTransformMatrix(2, 0, 0, 1);
    expect(result).toBeNull();
  });

  it("should return null for degenerate matrix (zero scale)", () => {
    const result = extractRotationFromTransformMatrix(0, 0, 0, 0);
    expect(result).toBeNull();
  });

  it("should handle negative rotation (-30 degrees)", () => {
    // For a -30° rotation matrix, the function returns +30° due to negation
    const angle = -Math.PI / 6; // -30 degrees
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const result = extractRotationFromTransformMatrix(cos, -sin, sin, cos);
    // The function negates atan2 result, so -30° input matrix yields +30° output
    expect(result).toBeCloseTo(-angle, 5);
  });
});

describe("hasSkewTransform", () => {
  it("should return false for identity (no XY/YX components)", () => {
    expect(hasSkewTransform(0, 0)).toBe(false);
  });

  it("should return true when XY is non-zero", () => {
    expect(hasSkewTransform(0.5, 0)).toBe(true);
  });

  it("should return true when YX is non-zero", () => {
    expect(hasSkewTransform(0, 0.5)).toBe(true);
  });

  it("should return false for values within tolerance", () => {
    expect(hasSkewTransform(0.0005, 0.0005)).toBe(false);
  });

  it("should return true for values just above tolerance", () => {
    expect(hasSkewTransform(0.002, 0)).toBe(true);
  });
});
