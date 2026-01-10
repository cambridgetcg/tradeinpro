/**
 * Vision Model Image Preprocessor
 *
 * Handles image loading, resizing, and normalization for the vision model.
 * Works with both local files and URLs.
 */

import * as fs from "fs";
import * as path from "path";
import { VISION_CONFIG } from "../config";
import type { PreprocessedImage } from "./types";

// =============================================================================
// IMAGE LOADING
// =============================================================================

/**
 * Load image from various sources
 */
export async function loadImage(
  source: string,
  sourceType: "base64" | "url" | "filepath"
): Promise<Buffer> {
  switch (sourceType) {
    case "base64":
      return loadFromBase64(source);
    case "url":
      return loadFromUrl(source);
    case "filepath":
      return loadFromFile(source);
    default:
      throw new Error(`Unsupported image source type: ${sourceType}`);
  }
}

/**
 * Load image from base64 string
 */
function loadFromBase64(base64: string): Buffer {
  // Remove data URL prefix if present
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(base64Data, "base64");
}

/**
 * Load image from URL
 */
async function loadFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Load image from local file
 */
function loadFromFile(filepath: string): Buffer {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Image file not found: ${filepath}`);
  }

  return fs.readFileSync(filepath);
}

// =============================================================================
// IMAGE PREPROCESSING
// =============================================================================

/**
 * Preprocess image for model input
 *
 * This is a simplified implementation. In production, you'd use
 * sharp or canvas for actual image processing.
 */
export async function preprocessImage(
  imageBuffer: Buffer,
  targetSize: number = VISION_CONFIG.image.targetSize
): Promise<PreprocessedImage> {
  // In a real implementation, you would:
  // 1. Decode the image (JPEG, PNG, etc.)
  // 2. Resize to target dimensions
  // 3. Convert to RGB if needed
  // 4. Normalize pixel values

  // For now, we return a placeholder that indicates preprocessing steps
  // The actual implementation would use sharp, canvas, or TensorFlow.js image utilities

  const { mean, std } = VISION_CONFIG.image.normalize;

  // Placeholder: Create a dummy tensor of the correct shape
  // In production, this would be actual pixel data
  const tensor: number[][][] = [];
  for (let h = 0; h < targetSize; h++) {
    const row: number[][] = [];
    for (let w = 0; w < targetSize; w++) {
      // Placeholder normalized pixel values
      row.push([
        (0.5 - mean[0]) / std[0], // R
        (0.5 - mean[1]) / std[1], // G
        (0.5 - mean[2]) / std[2], // B
      ]);
    }
    tensor.push(row);
  }

  return {
    tensor,
    originalWidth: 0, // Would be actual dimensions
    originalHeight: 0,
    preprocessing: {
      resized: true,
      normalized: true,
      cropped: false,
    },
  };
}

/**
 * Apply ImageNet normalization
 */
export function normalizePixels(
  pixels: number[][][],
  mean: number[] = VISION_CONFIG.image.normalize.mean,
  std: number[] = VISION_CONFIG.image.normalize.std
): number[][][] {
  const normalized: number[][][] = [];

  for (const row of pixels) {
    const normalizedRow: number[][] = [];
    for (const pixel of row) {
      normalizedRow.push([
        (pixel[0] / 255 - mean[0]) / std[0],
        (pixel[1] / 255 - mean[1]) / std[1],
        (pixel[2] / 255 - mean[2]) / std[2],
      ]);
    }
    normalized.push(normalizedRow);
  }

  return normalized;
}

/**
 * Convert tensor to flat array for model input
 */
export function flattenTensor(tensor: number[][][]): number[] {
  const flat: number[] = [];

  for (const row of tensor) {
    for (const pixel of row) {
      flat.push(...pixel);
    }
  }

  return flat;
}

/**
 * Reshape flat array back to tensor
 */
export function reshapeTensor(flat: number[], height: number, width: number): number[][][] {
  const tensor: number[][][] = [];
  let idx = 0;

  for (let h = 0; h < height; h++) {
    const row: number[][] = [];
    for (let w = 0; w < width; w++) {
      row.push([flat[idx++], flat[idx++], flat[idx++]]);
    }
    tensor.push(row);
  }

  return tensor;
}

// =============================================================================
// IMAGE AUGMENTATION (for training)
// =============================================================================

/**
 * Apply random augmentation for training
 */
export function augmentImage(tensor: number[][][]): number[][][] {
  // Random augmentations for training:
  // - Rotation (±15°)
  // - Brightness/contrast variation
  // - Blur
  // - Perspective transform

  // Placeholder: return original
  // Real implementation would apply random transforms
  return tensor;
}

/**
 * Apply test-time augmentation for better predictions
 */
export function applyTTA(tensor: number[][][]): number[][][][] {
  // Test-time augmentation: create multiple versions
  // and average predictions
  return [
    tensor, // Original
    flipHorizontal(tensor), // Horizontal flip
    // Could add more: slight rotations, brightness variations
  ];
}

/**
 * Flip image horizontally
 */
function flipHorizontal(tensor: number[][][]): number[][][] {
  return tensor.map((row) => [...row].reverse());
}

// =============================================================================
// CARD-SPECIFIC PREPROCESSING
// =============================================================================

/**
 * Detect card boundaries in image
 *
 * For eBay listings, cards are often photographed at angles
 * or with backgrounds. This would detect and crop the card.
 */
export async function detectCardBoundaries(
  tensor: number[][][]
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  // In production, this would use:
  // 1. Edge detection (Canny)
  // 2. Contour finding
  // 3. Rectangle fitting
  // 4. Perspective correction

  // Placeholder: assume card fills image
  return {
    x: 0,
    y: 0,
    width: tensor[0]?.length ?? 0,
    height: tensor.length,
  };
}

/**
 * Extract card region from image
 */
export function extractCardRegion(
  tensor: number[][][],
  bounds: { x: number; y: number; width: number; height: number }
): number[][][] {
  const extracted: number[][][] = [];

  for (let h = bounds.y; h < bounds.y + bounds.height && h < tensor.length; h++) {
    const row: number[][] = [];
    for (let w = bounds.x; w < bounds.x + bounds.width && w < (tensor[0]?.length ?? 0); w++) {
      row.push(tensor[h][w]);
    }
    extracted.push(row);
  }

  return extracted;
}

/**
 * Analyze image quality
 */
export function analyzeImageQuality(tensor: number[][][]): {
  brightness: number;
  contrast: number;
  sharpness: number;
  isUsable: boolean;
} {
  // Calculate basic image statistics
  let sum = 0;
  let count = 0;
  const values: number[] = [];

  for (const row of tensor) {
    for (const pixel of row) {
      const gray = (pixel[0] + pixel[1] + pixel[2]) / 3;
      sum += gray;
      values.push(gray);
      count++;
    }
  }

  const mean = sum / count;

  // Calculate variance for contrast
  let variance = 0;
  for (const v of values) {
    variance += Math.pow(v - mean, 2);
  }
  variance /= count;
  const contrast = Math.sqrt(variance);

  // Brightness is just the mean (normalized)
  const brightness = (mean + 2) / 4; // Assuming normalized range

  // Sharpness would require Laplacian or similar
  // Placeholder
  const sharpness = 0.5;

  // Image is usable if not too dark/bright and has reasonable contrast
  const isUsable = brightness > 0.1 && brightness < 0.9 && contrast > 0.05;

  return {
    brightness,
    contrast,
    sharpness,
    isUsable,
  };
}

// =============================================================================
// CONDITION ANALYSIS PREPROCESSING
// =============================================================================

/**
 * Extract corner regions for condition analysis
 */
export function extractCorners(
  tensor: number[][][],
  cornerSize: number = 32
): {
  topLeft: number[][][];
  topRight: number[][][];
  bottomLeft: number[][][];
  bottomRight: number[][][];
} {
  const height = tensor.length;
  const width = tensor[0]?.length ?? 0;

  return {
    topLeft: extractRegion(tensor, 0, 0, cornerSize, cornerSize),
    topRight: extractRegion(tensor, width - cornerSize, 0, cornerSize, cornerSize),
    bottomLeft: extractRegion(tensor, 0, height - cornerSize, cornerSize, cornerSize),
    bottomRight: extractRegion(
      tensor,
      width - cornerSize,
      height - cornerSize,
      cornerSize,
      cornerSize
    ),
  };
}

/**
 * Extract edge regions for condition analysis
 */
export function extractEdges(
  tensor: number[][][],
  edgeWidth: number = 16
): {
  top: number[][][];
  bottom: number[][][];
  left: number[][][];
  right: number[][][];
} {
  const height = tensor.length;
  const width = tensor[0]?.length ?? 0;

  return {
    top: extractRegion(tensor, 0, 0, width, edgeWidth),
    bottom: extractRegion(tensor, 0, height - edgeWidth, width, edgeWidth),
    left: extractRegion(tensor, 0, 0, edgeWidth, height),
    right: extractRegion(tensor, width - edgeWidth, 0, edgeWidth, height),
  };
}

/**
 * Extract a rectangular region from tensor
 */
function extractRegion(
  tensor: number[][][],
  x: number,
  y: number,
  width: number,
  height: number
): number[][][] {
  const region: number[][][] = [];

  const startY = Math.max(0, y);
  const endY = Math.min(tensor.length, y + height);
  const startX = Math.max(0, x);
  const endX = Math.min(tensor[0]?.length ?? 0, x + width);

  for (let h = startY; h < endY; h++) {
    const row: number[][] = [];
    for (let w = startX; w < endX; w++) {
      row.push(tensor[h][w]);
    }
    region.push(row);
  }

  return region;
}
