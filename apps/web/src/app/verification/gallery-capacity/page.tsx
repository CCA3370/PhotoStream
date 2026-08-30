import type { PublicMediaView } from "@photostream/contracts";

import { MediaGrid } from "@/components/gallery/media-grid";

const items: readonly PublicMediaView[] = Array.from({ length: 5_000 }, (_, index) => {
  const sequence = 5_000 - index;
  return {
    id: `00000000-0000-7000-8000-${sequence.toString().padStart(12, "0")}`,
    width: 1_920,
    height: 1_280,
    publishSequence: sequence,
    publishedAt: "2026-08-28T00:00:00.000Z",
    variants: [],
    downloads: {
      preview: false,
      original: false,
      originalBytes: null,
    },
  };
});

export default function GalleryCapacityPage() {
  return (
    <main className="public-theme min-h-screen bg-background px-3 py-8 text-foreground sm:px-4 md:px-6">
      <section
        aria-labelledby="capacity-heading"
        className="mx-auto flex max-w-[1440px] flex-col gap-5"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">本地自动化验证面</p>
          <h1 className="text-2xl font-semibold" id="capacity-heading">
            5,000 项窗口化网格
          </h1>
        </div>
        <MediaGrid items={items} />
      </section>
    </main>
  );
}
