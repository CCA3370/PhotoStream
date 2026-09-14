import type { PublicMediaView } from "@photostream/contracts";

const featuredPromotionMin = 12;
const featuredPromotionSpan = 42;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function featuredPromotion(mediaId: string): number {
  return featuredPromotionMin + (stableHash(mediaId) % featuredPromotionSpan);
}

export function orderFeaturedMedia(
  source: readonly PublicMediaView[],
  featuredIds: ReadonlySet<string>,
): readonly PublicMediaView[] {
  if (source.length < 2 || featuredIds.size === 0) return source;

  return source
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      score: item.publishSequence + (featuredIds.has(item.id) ? featuredPromotion(item.id) : 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.publishSequence - left.item.publishSequence ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ item }) => item);
}
