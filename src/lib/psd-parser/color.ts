import { VectorNumberTypeItem, VectorObjectTypeItem } from "./interfaces";

export function normalizeColorValue(value: number): number {
  return value / 255.0;
}
export function normalizeColorFloatValue(value: number): number {
  return Math.min(Math.max(value, 0.0), 1.0);
}

export function parseColor(color: VectorObjectTypeItem): {
  r: number;
  g: number;
  b: number;
} | null {
  const redItem = color.descriptor.items.get("Rd  ") as VectorNumberTypeItem;
  const greenItem = color.descriptor.items.get("Grn ") as VectorNumberTypeItem;
  const blueItem = color.descriptor.items.get("Bl  ") as VectorNumberTypeItem;
  if (redItem && greenItem && blueItem) {
    const r = normalizeColorValue(redItem.value);
    const g = normalizeColorValue(greenItem.value);
    const b = normalizeColorValue(blueItem.value);
    return { r, g, b };
  }

  const redFloat = color.descriptor.items.get(
    "redFloat"
  ) as VectorNumberTypeItem;
  const greenFloat = color.descriptor.items.get(
    "greenFloat"
  ) as VectorNumberTypeItem;
  const blueFloat = color.descriptor.items.get(
    "blueFloat"
  ) as VectorNumberTypeItem;

  if (redFloat && greenFloat && blueFloat) {
    return {
      r: normalizeColorFloatValue(redFloat.value),
      g: normalizeColorFloatValue(greenFloat.value),
      b: normalizeColorFloatValue(blueFloat.value),
    };
  }
  return null;
}
