export const photoEditPipelineVersion = "local-edit-v2";
export const photoEditRecipeVersion = 2;

export interface PhotoEditRecipe {
  readonly version: 2;
  readonly exposureEv: number;
  readonly temperature: number;
  readonly tint: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly contrast: number;
  readonly vibrance: number;
  readonly saturation: number;
  readonly sharpen: number;
  readonly denoiseStrength: number;
  readonly deblurStrength: number;
}

export const defaultPhotoEditRecipe: PhotoEditRecipe = {
  version: 2,
  exposureEv: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  contrast: 0,
  vibrance: 0,
  saturation: 0,
  sharpen: 0,
  denoiseStrength: 0,
  deblurStrength: 0,
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizePhotoEditRecipe(
  recipe: Partial<Omit<PhotoEditRecipe, "version">> & { readonly version?: 1 | 2 },
): PhotoEditRecipe {
  return {
    version: 2,
    exposureEv: clamp(recipe.exposureEv ?? 0, -2, 2),
    temperature: clamp(recipe.temperature ?? 0, -1, 1),
    tint: clamp(recipe.tint ?? 0, -1, 1),
    highlights: clamp(recipe.highlights ?? 0, -100, 100),
    shadows: clamp(recipe.shadows ?? 0, -100, 100),
    contrast: clamp(recipe.contrast ?? 0, -100, 100),
    vibrance: clamp(recipe.vibrance ?? 0, -100, 100),
    saturation: clamp(recipe.saturation ?? 0, -100, 100),
    sharpen: clamp(recipe.sharpen ?? 0, 0, 100),
    denoiseStrength: clamp(recipe.denoiseStrength ?? 0, 0, 1),
    deblurStrength: clamp(recipe.deblurStrength ?? 0, 0, 0.6),
  };
}

export function photoEditRecipeFromUnknown(value: unknown): PhotoEditRecipe {
  if (typeof value !== "object" || value === null) return defaultPhotoEditRecipe;
  const input = value as Record<string, unknown>;
  const parsed: Partial<Omit<PhotoEditRecipe, "version">> = {};
  for (const key of [
    "exposureEv",
    "temperature",
    "tint",
    "highlights",
    "shadows",
    "contrast",
    "vibrance",
    "saturation",
    "sharpen",
    "denoiseStrength",
    "deblurStrength",
  ] as const) {
    if (typeof input[key] === "number") parsed[key] = input[key];
  }
  return normalizePhotoEditRecipe(parsed);
}

export function photoEditRecipeIsIdentity(recipe: PhotoEditRecipe): boolean {
  return (
    recipe.exposureEv === 0 &&
    recipe.temperature === 0 &&
    recipe.tint === 0 &&
    recipe.highlights === 0 &&
    recipe.shadows === 0 &&
    recipe.contrast === 0 &&
    recipe.vibrance === 0 &&
    recipe.saturation === 0 &&
    recipe.sharpen === 0 &&
    recipe.denoiseStrength === 0 &&
    recipe.deblurStrength === 0
  );
}
