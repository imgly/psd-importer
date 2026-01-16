/**
 * Extracts the rotation angle from a PSD transform matrix, if it represents a pure rotation.
 * Returns null if the matrix contains skew/shear (which CE.SDK doesn't support).
 *
 * A 2D transform matrix has the form:
 * | XX  XY  TX |
 * | YX  YY  TY |
 *
 * For a pure rotation with scale:
 * - XX = scale * cos(θ), XY = -scale * sin(θ)
 * - YX = scale * sin(θ), YY = scale * cos(θ)
 * - After normalizing: XX ≈ YY and XY ≈ -YX
 *
 * For a skew/shear transform, this relationship doesn't hold.
 */
export function extractRotationFromTransformMatrix(
  transformXX: number,
  transformXY: number,
  transformYX: number,
  transformYY: number
): number | null {
  // Calculate the scale factors
  const scaleX = Math.sqrt(
    transformXX * transformXX + transformXY * transformXY
  );
  const scaleY = Math.sqrt(
    transformYY * transformYY + transformYX * transformYX
  );

  // Guard against degenerate matrices (zero scale)
  if (scaleX < 1e-10 || scaleY < 1e-10) {
    return null;
  }

  // Normalize the matrix components to remove scale
  const normalizedXX = transformXX / scaleX;
  const normalizedXY = transformXY / scaleX;
  const normalizedYX = transformYX / scaleY;
  const normalizedYY = transformYY / scaleY;

  // Check if this is a pure rotation matrix (within tolerance)
  const tolerance = 0.01;
  const isRotation =
    Math.abs(normalizedXX - normalizedYY) < tolerance &&
    Math.abs(normalizedXY + normalizedYX) < tolerance;

  if (!isRotation) {
    return null;
  }

  const angleRadians = -Math.atan2(normalizedYX, normalizedXX);
  // Return null for negligible rotations
  if (Math.abs(angleRadians) < 1e-10) {
    return null;
  }

  return angleRadians;
}

/**
 * Checks if a transform matrix contains a skew/shear component.
 */
export function hasSkewTransform(
  transformXY: number,
  transformYX: number
): boolean {
  return Math.abs(transformXY) > 0.001 || Math.abs(transformYX) > 0.001;
}
