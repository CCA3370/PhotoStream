import type { InternalMediaList } from "@photostream/contracts";

export function reviewSyncRevision(
  media: InternalMediaList,
  featuredMediaIds: readonly string[],
): string {
  const mediaRevision = media.items
    .map((item) => {
      const variants = [...item.variants]
        .map((variant) => `${variant.kind}:${variant.bytes}`)
        .sort()
        .join(",");
      return [
        item.id,
        item.ingestStatus,
        item.publicationStatus,
        item.categoryId ?? "",
        item.deletionTask?.status ?? "",
        variants,
        JSON.stringify(item.bib ?? null),
      ].join(":");
    })
    .join("|");
  const featuredRevision = [...featuredMediaIds].sort().join(",");
  return `${media.nextCursor ?? ""}#${mediaRevision}#featured:${featuredRevision}`;
}
