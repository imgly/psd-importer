import { CMYKColor, Color } from "@cesdk/engine";
import { VectorNumberTypeItem, VectorObjectTypeItem } from "./interfaces";

export function normalizeColorValue(value: number): number {
  return value / 255.0;
}
export function normalizeColorFloatValue(value: number): number {
  return Math.min(Math.max(value, 0.0), 1.0);
}

export function parseColor(color: VectorObjectTypeItem): Color | null {
  const redItem = color.descriptor.items.get("Rd  ") as VectorNumberTypeItem;
  const greenItem = color.descriptor.items.get("Grn ") as VectorNumberTypeItem;
  const blueItem = color.descriptor.items.get("Bl  ") as VectorNumberTypeItem;
  if (redItem && greenItem && blueItem) {
    const r = normalizeColorValue(redItem.value);
    const g = normalizeColorValue(greenItem.value);
    const b = normalizeColorValue(blueItem.value);
    return { r, g, b, a: 1 };
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
      a: 1,
    };
  }

  const Cyn = color.descriptor.items.get("Cyn ") as VectorNumberTypeItem;
  const Mgn = color.descriptor.items.get("Mgnt") as VectorNumberTypeItem;
  const Ylw = color.descriptor.items.get("Ylw ") as VectorNumberTypeItem;
  const Blck = color.descriptor.items.get("Blck") as VectorNumberTypeItem;
  if (Cyn !== undefined && Mgn !== undefined && Ylw !== undefined) {
    const color: CMYKColor = {
      c: Cyn.value / 100,
      m: Mgn.value / 100,
      y: Ylw.value / 100,
      k: Blck.value / 100,
      tint: 1,
    };
    return color;
  }
  return null;
}
