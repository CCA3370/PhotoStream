import type { PhotoEditRecipe } from "./recipe";

export interface MutablePixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function channel(value: number): number {
  return Math.round(clamp01(value) * 255);
}

export function applyPhotoEditRecipeToPixels(
  buffer: MutablePixelBuffer,
  recipe: PhotoEditRecipe,
): void {
  const { data, width, height } = buffer;
  const exposure = 2 ** recipe.exposureEv;
  const temperature = recipe.temperature * 0.18;
  const tint = recipe.tint * 0.12;
  const redGain = 1 + temperature + tint * 0.45;
  const greenGain = 1 - tint;
  const blueGain = 1 - temperature + tint * 0.45;
  const contrast = 1 + (recipe.contrast / 100) * 0.8;
  const shadowAmount = (recipe.shadows / 100) * 0.3;
  const highlightAmount = (recipe.highlights / 100) * 0.28;
  const saturationAmount = recipe.saturation / 100;
  const vibranceAmount = recipe.vibrance / 100;

  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] ?? 0;
    if (alpha === 0) continue;

    let red = ((data[offset] ?? 0) / 255) * exposure * redGain;
    let green = ((data[offset + 1] ?? 0) / 255) * exposure * greenGain;
    let blue = ((data[offset + 2] ?? 0) / 255) * exposure * blueGain;

    let light = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const shadowWeight = (1 - clamp01(light)) ** 2;
    const highlightWeight = clamp01(light) ** 2;
    const toneDelta = shadowAmount * shadowWeight + highlightAmount * highlightWeight;
    red += toneDelta;
    green += toneDelta;
    blue += toneDelta;

    red = (red - 0.5) * contrast + 0.5;
    green = (green - 0.5) * contrast + 0.5;
    blue = (blue - 0.5) * contrast + 0.5;

    light = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const currentSaturation = maximum <= 0 ? 0 : (maximum - minimum) / maximum;
    const vibranceGain = vibranceAmount * (1 - clamp01(currentSaturation)) * 0.55;
    const saturationGain = 1 + saturationAmount * 0.75 + vibranceGain;
    red = light + (red - light) * saturationGain;
    green = light + (green - light) * saturationGain;
    blue = light + (blue - light) * saturationGain;

    data[offset] = channel(red);
    data[offset + 1] = channel(green);
    data[offset + 2] = channel(blue);
  }

  if (recipe.sharpen <= 0 || width < 3 || height < 3) return;

  const original = new Uint8ClampedArray(data);
  const strength = Math.min(0.5, (recipe.sharpen / 100) * 0.5);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      if ((original[offset + 3] ?? 0) === 0) continue;
      for (let component = 0; component < 3; component += 1) {
        const center = original[offset + component] ?? 0;
        const left = original[offset - 4 + component] ?? center;
        const right = original[offset + 4 + component] ?? center;
        const top = original[offset - width * 4 + component] ?? center;
        const bottom = original[offset + width * 4 + component] ?? center;
        const blur = (left + right + top + bottom) / 4;
        data[offset + component] = Math.round(
          Math.min(255, Math.max(0, center + (center - blur) * strength)),
        );
      }
    }
  }
}
