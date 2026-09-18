import { normalizePhotoEditRecipe, type PhotoEditRecipe } from "./recipe";

export interface PhotoPixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface PhotoEditAnalysis {
  readonly p01: number;
  readonly p05: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly shadowClipRatio: number;
  readonly highlightClipRatio: number;
  readonly meanSaturation: number;
  readonly dynamicRange: number;
  readonly neutralRed: number;
  readonly neutralGreen: number;
  readonly neutralBlue: number;
  readonly neutralConfidence: number;
  readonly sharpness: number;
  readonly noise: number;
}

const histogramSize = 256;

function luminance(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  if (total <= 0) return 0;
  const target = Math.max(1, Math.ceil(total * fraction));
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index] ?? 0;
    if (cumulative >= target) return index / 255;
  }
  return 1;
}

export function analyzePhotoPixels(buffer: PhotoPixelBuffer): PhotoEditAnalysis {
  const histogram = new Uint32Array(histogramSize);
  let total = 0;
  let clippedShadow = 0;
  let clippedHighlight = 0;
  let saturationSum = 0;
  let neutralCount = 0;
  let neutralRed = 0;
  let neutralGreen = 0;
  let neutralBlue = 0;
  let sharpnessSum = 0;
  let noiseSum = 0;
  let gradientCount = 0;

  const { data, width, height } = buffer;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 250_000)));

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] ?? 0;
      if (alpha < 16) continue;
      const red = (data[offset] ?? 0) / 255;
      const green = (data[offset + 1] ?? 0) / 255;
      const blue = (data[offset + 2] ?? 0) / 255;
      const light = luminance(red, green, blue);
      const bucket = Math.min(255, Math.max(0, Math.round(light * 255)));
      histogram[bucket] = (histogram[bucket] ?? 0) + 1;
      total += 1;
      if (bucket <= 2) clippedShadow += 1;
      if (bucket >= 253) clippedHighlight += 1;

      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const saturation = maximum <= 0 ? 0 : (maximum - minimum) / maximum;
      saturationSum += saturation;

      if (light >= 0.12 && light <= 0.88 && saturation <= 0.12) {
        const weight = 1 - saturation / 0.12;
        neutralRed += red * weight;
        neutralGreen += green * weight;
        neutralBlue += blue * weight;
        neutralCount += weight;
      }

      if (x + stride < width && y + stride < height) {
        const right = offset + stride * 4;
        const below = offset + stride * width * 4;
        const rightLight = luminance(
          (data[right] ?? 0) / 255,
          (data[right + 1] ?? 0) / 255,
          (data[right + 2] ?? 0) / 255,
        );
        const belowLight = luminance(
          (data[below] ?? 0) / 255,
          (data[below + 1] ?? 0) / 255,
          (data[below + 2] ?? 0) / 255,
        );
        const gx = rightLight - light;
        const gy = belowLight - light;
        const gradient = Math.sqrt(gx * gx + gy * gy);
        sharpnessSum += gradient;
        noiseSum += Math.min(Math.abs(gx - gy), 0.25);
        gradientCount += 1;
      }
    }
  }

  const p01 = percentile(histogram, total, 0.01);
  const p05 = percentile(histogram, total, 0.05);
  const p50 = percentile(histogram, total, 0.5);
  const p95 = percentile(histogram, total, 0.95);
  const p99 = percentile(histogram, total, 0.99);

  return {
    p01,
    p05,
    p50,
    p95,
    p99,
    shadowClipRatio: total === 0 ? 0 : clippedShadow / total,
    highlightClipRatio: total === 0 ? 0 : clippedHighlight / total,
    meanSaturation: total === 0 ? 0 : saturationSum / total,
    dynamicRange: Math.max(0, p95 - p05),
    neutralRed: neutralCount === 0 ? 0 : neutralRed / neutralCount,
    neutralGreen: neutralCount === 0 ? 0 : neutralGreen / neutralCount,
    neutralBlue: neutralCount === 0 ? 0 : neutralBlue / neutralCount,
    neutralConfidence: total === 0 ? 0 : Math.min(1, neutralCount / Math.max(1, total * 0.12)),
    sharpness: gradientCount === 0 ? 0 : sharpnessSum / gradientCount,
    noise: gradientCount === 0 ? 0 : noiseSum / gradientCount,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function automaticPhotoEditRecipe(analysis: PhotoEditAnalysis): PhotoEditRecipe {
  const targetMedian = 0.48;
  const safeMedian = Math.max(analysis.p50, 0.04);
  let exposureEv = Math.log2(targetMedian / safeMedian);
  if (analysis.highlightClipRatio > 0.02 || analysis.p99 > 0.98) {
    exposureEv = Math.min(exposureEv, 0.15);
  }
  exposureEv = clamp(exposureEv, -1.2, 1.2);

  const highlightPressure = clamp((analysis.p95 - 0.78) / 0.2, 0, 1);
  const shadowDepth = clamp((0.24 - analysis.p05) / 0.24, 0, 1);
  const sceneDarkness = clamp((0.42 - analysis.p50) / 0.3, 0, 1);
  const highlights = Math.round(-35 * highlightPressure);
  const shadows = Math.round(22 * shadowDepth * sceneDarkness);

  let temperature = 0;
  let tint = 0;
  if (analysis.neutralConfidence >= 0.18) {
    const average = (analysis.neutralRed + analysis.neutralGreen + analysis.neutralBlue) / 3 || 1;
    const redBias = analysis.neutralRed / average - 1;
    const greenBias = analysis.neutralGreen / average - 1;
    const blueBias = analysis.neutralBlue / average - 1;
    temperature = clamp((blueBias - redBias) * 0.8, -0.35, 0.35);
    tint = clamp((greenBias - (redBias + blueBias) / 2) * 0.65, -0.25, 0.25);
  }

  const contrast =
    analysis.dynamicRange < 0.42
      ? Math.round(clamp((0.42 - analysis.dynamicRange) * 35, 0, 12))
      : analysis.dynamicRange > 0.82
        ? -Math.round(clamp((analysis.dynamicRange - 0.82) * 30, 0, 8))
        : 0;
  const vibrance = Math.round(clamp((0.42 - analysis.meanSaturation) * 28, 0, 12));
  const sharpen = Math.round(clamp((0.035 - analysis.sharpness) * 420, 0, 10));

  return normalizePhotoEditRecipe({
    exposureEv,
    temperature,
    tint,
    highlights,
    shadows,
    contrast,
    vibrance,
    saturation: 0,
    sharpen,
  });
}
