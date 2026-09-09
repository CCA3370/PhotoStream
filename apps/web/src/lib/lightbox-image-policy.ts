export type LightboxVariantKind = "photo_960" | "photo_1920";

export interface LightboxImagePolicyInput {
  readonly mediaWidth: number;
  readonly mediaHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
  readonly saveData?: boolean | undefined;
  readonly effectiveType?: string | undefined;
  readonly has960: boolean;
  readonly has1920: boolean;
}

const highResolutionThresholdPx = 1_200;

export function effectiveLightboxDpr(options: {
  readonly devicePixelRatio: number;
  readonly saveData?: boolean | undefined;
  readonly effectiveType?: string | undefined;
}): number {
  const dpr = Number.isFinite(options.devicePixelRatio)
    ? Math.max(1, Math.min(2, options.devicePixelRatio))
    : 1;
  if (options.saveData || options.effectiveType === "slow-2g" || options.effectiveType === "2g") {
    return 1;
  }
  if (options.effectiveType === "3g") return Math.min(1.5, dpr);
  return dpr;
}

export function renderedLightboxWidth(options: {
  readonly mediaWidth: number;
  readonly mediaHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): number {
  if (
    options.mediaWidth <= 0 ||
    options.mediaHeight <= 0 ||
    options.viewportWidth <= 0 ||
    options.viewportHeight <= 0
  ) {
    return 0;
  }
  return Math.min(
    options.viewportWidth,
    options.viewportHeight * (options.mediaWidth / options.mediaHeight),
  );
}

export function selectLightboxVariantKind(
  options: LightboxImagePolicyInput,
): LightboxVariantKind | null {
  if (!options.has960 && !options.has1920) return null;
  if (!options.has960) return "photo_1920";
  if (!options.has1920) return "photo_960";

  const cssWidth = renderedLightboxWidth(options);
  if (cssWidth <= 0) return "photo_960";
  const dpr = effectiveLightboxDpr(options);
  const requiredPixels = Math.min(options.mediaWidth, cssWidth * dpr);
  return requiredPixels > highResolutionThresholdPx ? "photo_1920" : "photo_960";
}
