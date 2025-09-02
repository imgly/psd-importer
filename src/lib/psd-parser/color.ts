import CreativeEngine, { CMYKColor, Color } from "@cesdk/engine";
import { VectorNumberTypeItem, VectorObjectTypeItem, DescriptorValue, VectorUnitTypeItem, VectorEnumeratedTypeItem } from "./interfaces";
import { angleToGradientControlPoints } from "./utils";

interface GradientColorStop {
  stop: number;
  color: Color;
}

interface ParsedGradient {
  type: "linear" | "radial" | "unsupported";
  angle: number;
  stops: GradientColorStop[];
}

export function normalizeColorValue(value: number): number {
  return value / 255.0;
}
export function normalizeColorFloatValue(value: number): number {
  return Math.min(Math.max(value, 0.0), 1.0);
}

export function parseColor(
  color: VectorObjectTypeItem | undefined
): Color | null {
  if (!color) return null;

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

export function parseGradientFromVscg(
  vscgData: DescriptorValue,
  logger?: { log: (message: string, type?: "error" | "warning" | "info") => void }
): ParsedGradient | null {
  if (logger) {
    logger.log(`parseGradientFromVscg called with data type: ${vscgData.type}`, "info");
  }

  if (vscgData.type !== "Objc") {
    if (logger) {
      logger.log(`Expected 'Objc' type, got '${vscgData.type}'. Cannot parse gradient.`, "warning");
    }
    return null;
  }

  const descriptor = vscgData.descriptor;
  if (logger) {
    logger.log(`Descriptor found with ${descriptor.items.size} items: ${Array.from(descriptor.items.keys()).join(", ")}`, "info");
  }
  
  // Extract gradient type
  const gradientType = descriptor.items.get("Type") as VectorEnumeratedTypeItem;
  let type: "linear" | "radial" | "unsupported" = "unsupported";
  
  if (gradientType?.enumValue === "Lnr ") {
    type = "linear";
  } else if (gradientType?.enumValue === "Rdl ") {
    type = "radial";
  } else {
    if (logger) {
      logger.log(`Unsupported gradient type: ${gradientType?.enumValue || "unknown"}. Supported types are linear ("Lnr ") and radial ("Rdl ")`, "warning");
    }
    return null;
  }

  // Extract angle
  const angleData = descriptor.items.get("Angl") as VectorUnitTypeItem;
  const angle = angleData?.value || 0;
  
  if (logger) {
    logger.log(`Gradient type: ${type}, angle: ${angle}`, "info");
  }

  // The gradient data is directly in the VSCG descriptor, not in a sub-item
  // We'll parse color stops from the descriptor itself or create default ones
  const stops: GradientColorStop[] = [];
  const gradItems = descriptor.items;

  if (logger) {
    logger.log(`Parsing gradient from VSCG with ${gradItems.size} items: ${Array.from(gradItems.keys()).join(", ")}`, "info");
  }

  // Check if there's a separate Grad definition (might be empty in some cases)
  const gradientDef = gradItems.get("Grad") as DescriptorValue;
  if (logger) {
    logger.log(`Grad definition: ${JSON.stringify(gradientDef, null, 2)}`, "info");
  }
  
  if (gradientDef && gradientDef.type === "Objc" && gradientDef.descriptor.items.size > 0) {
    // Use the gradient definition if it has data
    const gradDefItems = gradientDef.descriptor.items;
    if (logger) {
      logger.log(`Found gradient definition with ${gradDefItems.size} items: ${Array.from(gradDefItems.keys()).join(", ")}`, "info");
      for (const [key, value] of gradDefItems.entries()) {
        logger.log(`  GradDef ${key}: ${JSON.stringify(value, null, 2)}`, "info");
      }
    }
    
    // Parse from the gradient definition - handle VlLs (Value List) format
    const colors = gradDefItems.get("Clrs");
    const transparencies = gradDefItems.get("Trns");
    
    if (colors && colors.type === "VlLs" && Array.isArray(colors.values)) {
      if (logger) {
        logger.log(`Processing ${colors.values.length} color stops from VlLs`, "info");
        if (transparencies && transparencies.type === "VlLs" && Array.isArray(transparencies.values)) {
          logger.log(`Found ${transparencies.values.length} transparency stops`, "info");
        }
      }
      
      colors.values.forEach((colorStop: any, index: number) => {
        if (colorStop.type === "Objc") {
          // Try to get color data from the color stop descriptor
          const colorItems = colorStop.descriptor.items;
          if (logger) {
            logger.log(`Color stop ${index} items: ${Array.from(colorItems.keys()).join(", ")}`, "info");
          }
          
          // Try to parse the actual color from the Clr item
          const colorData = colorItems.get("Clr ");
          const locationData = colorItems.get("Lctn");
          
          // Get position from location data, or fall back to index-based position
          const position = locationData?.value ? locationData.value / 4096 : (index / Math.max(colors.values.length - 1, 1));
          
          // Try to parse the actual color
          let color = parseColor(colorData);
          
          // Get opacity from transparency data if available
          let opacity = 1.0; // Default to fully opaque
          if (transparencies && transparencies.type === "VlLs" && Array.isArray(transparencies.values)) {
            // Parse all transparency stops with their positions and opacities
            const transparencyStops: Array<{position: number, opacity: number}> = [];
            
            transparencies.values.forEach((tStop: any, tIndex: number) => {
              if (tStop && tStop.type === "Objc") {
                const tItems = tStop.descriptor.items;
                const tLocationData = tItems.get("Lctn");
                const tOpacityData = tItems.get("Opct");
                
                if (tLocationData && tOpacityData) {
                  const tPosition = tLocationData.value / 4096; // Convert to 0-1 range
                  const tOpacity = tOpacityData.value / 100.0; // Convert from percentage
                  transparencyStops.push({ position: tPosition, opacity: tOpacity });
                  
                  if (logger) {
                    logger.log(`Transparency stop ${tIndex} at position ${tPosition.toFixed(3)} with opacity ${tOpacity}`, "info");
                  }
                }
              }
            });
            
            // Find the best matching transparency for this color stop position
            if (transparencyStops.length > 0) {
              if (transparencyStops.length === 1) {
                // Only one transparency stop, use it
                opacity = transparencyStops[0].opacity;
                if (logger) {
                  logger.log(`Color stop ${index} at ${position.toFixed(3)}: using single transparency opacity ${opacity}`, "info");
                }
              } else {
                // Multiple transparency stops - find closest or interpolate
                transparencyStops.sort((a, b) => a.position - b.position);
                
                // Find the transparency stops that bracket this color position
                let beforeStop = transparencyStops[0];
                let afterStop = transparencyStops[transparencyStops.length - 1];
                
                for (let i = 0; i < transparencyStops.length - 1; i++) {
                  if (transparencyStops[i].position <= position && transparencyStops[i + 1].position >= position) {
                    beforeStop = transparencyStops[i];
                    afterStop = transparencyStops[i + 1];
                    break;
                  }
                }
                
                // Interpolate opacity between the two stops
                if (beforeStop.position === afterStop.position) {
                  opacity = beforeStop.opacity;
                } else {
                  const factor = (position - beforeStop.position) / (afterStop.position - beforeStop.position);
                  opacity = beforeStop.opacity + factor * (afterStop.opacity - beforeStop.opacity);
                }
                
                if (logger) {
                  logger.log(`Color stop ${index} at ${position.toFixed(3)}: interpolated opacity ${opacity.toFixed(3)} between ${beforeStop.position.toFixed(3)}(${beforeStop.opacity}) and ${afterStop.position.toFixed(3)}(${afterStop.opacity})`, "info");
                }
              }
            }
          }
          
          if (!color) {
            // If we can't parse the actual color, create meaningful fallback colors
            if (colors.values.length === 3) {
              // 3-stop gradient: commonly used for highlights/shadows
              if (index === 0) color = { r: 0.2, g: 0.2, b: 0.2, a: 1 }; // Dark start
              else if (index === 1) color = { r: 0.9, g: 0.9, b: 0.9, a: 1 }; // Light middle  
              else color = { r: 0.1, g: 0.1, b: 0.1, a: 1 }; // Dark end
            } else {
              // Default to grayscale gradient
              const intensity = index / Math.max(colors.values.length - 1, 1);
              color = { r: intensity, g: intensity, b: intensity, a: 1 };
            }
            
            if (logger) {
              logger.log(`Could not parse color data for stop ${index}, using fallback`, "warning");
            }
          }
          
          // Apply opacity to the color
          if (color) {
            color.a = opacity;
          }
          
          stops.push({
            stop: Math.max(0, Math.min(1, position)),
            color
          });
          
          if (logger) {
            logger.log(`Added color stop at ${position}: ${JSON.stringify(color)} ${colorData ? '(parsed)' : '(fallback)'} opacity: ${opacity}`, "info");
          }
        }
      });
    }
  } else {
    // Log all items in the main descriptor to understand the structure
    if (logger) {
      logger.log("No usable gradient definition found. Main descriptor items:", "info");
      for (const [key, value] of gradItems.entries()) {
        logger.log(`  Main ${key}: ${JSON.stringify(value, null, 2)}`, "info");
      }
    }
  }

  // If no color stops were found in the gradient definition, create default ones
  if (stops.length === 0) {
    if (logger) {
      logger.log(`No specific gradient color stops found, creating default gradient based on type: ${type}`, "info");
    }
    
    // Create a meaningful default gradient based on the type
    // For linear gradients, create a classic black-to-white gradient
    // For radial gradients, create a center-to-edge fade
    if (type === "linear") {
      stops.push(
        { stop: 0, color: { r: 0, g: 0, b: 0, a: 1 } },      // Black at start
        { stop: 1, color: { r: 1, g: 1, b: 1, a: 1 } }       // White at end
      );
    } else if (type === "radial") {
      stops.push(
        { stop: 0, color: { r: 1, g: 1, b: 1, a: 1 } },      // White at center
        { stop: 1, color: { r: 0, g: 0, b: 0, a: 1 } }       // Black at edge
      );
    } else {
      // Unsupported type fallback
      stops.push(
        { stop: 0, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } },
        { stop: 1, color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }
      );
    }
  }

  // Sort stops by stop position
  stops.sort((a, b) => a.stop - b.stop);

  return {
    type,
    angle,
    stops
  };
}

export function createGradientFill(
  engine: CreativeEngine,
  gradient: ParsedGradient,
  parentBlock: number,
  logger?: { log: (message: string, type?: "error" | "warning" | "info") => void }
): number {
  const gradientType = gradient.type === "linear" 
    ? "//ly.img.ubq/fill/gradient/linear"
    : "//ly.img.ubq/fill/gradient/radial";

  const gradientFill = engine.block.createFill(gradientType);
  
  // Set gradient color stops
  engine.block.setGradientColorStops(
    gradientFill,
    "fill/gradient/colors",
    gradient.stops
  );

  if (gradient.type === "linear") {
    // Calculate control points based on angle and parent block aspect ratio
    const blockAspectRatio = engine.block.getWidth(parentBlock) / engine.block.getHeight(parentBlock);
    const controlPoints = angleToGradientControlPoints(gradient.angle, blockAspectRatio);
    
    if (logger) {
      logger.log(`Gradient control points for angle ${gradient.angle}°: start(${controlPoints.start.x.toFixed(3)}, ${controlPoints.start.y.toFixed(3)}) -> end(${controlPoints.end.x.toFixed(3)}, ${controlPoints.end.y.toFixed(3)})`, "info");
    }
    
    engine.block.setFloat(
      gradientFill,
      "fill/gradient/linear/startPointX",
      controlPoints.start.x
    );
    engine.block.setFloat(
      gradientFill,
      "fill/gradient/linear/startPointY", 
      1.0 - controlPoints.start.y  // Mirror Y-axis: top becomes bottom
    );
    engine.block.setFloat(
      gradientFill,
      "fill/gradient/linear/endPointX",
      controlPoints.end.x
    );
    engine.block.setFloat(
      gradientFill,
      "fill/gradient/linear/endPointY",
      1.0 - controlPoints.end.y  // Mirror Y-axis: top becomes bottom
    );
  } else if (gradient.type === "radial") {
    // For radial gradients, center at 0.5, 0.5
    engine.block.setFloat(gradientFill, "fill/gradient/radial/centerX", 0.5);
    engine.block.setFloat(gradientFill, "fill/gradient/radial/centerY", 0.5);
    engine.block.setFloat(gradientFill, "fill/gradient/radial/radiusX", 0.5);
    engine.block.setFloat(gradientFill, "fill/gradient/radial/radiusY", 0.5);
  }

  return gradientFill;
}
