import { PublicGalleryShell } from "@/components/shells/public-gallery-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const galleryPlaceholderIds = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
];

export default async function GalleryPage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  return (
    <PublicGalleryShell albumTitle="春季运动会">
      <nav aria-label="相册分类" className="sticky top-0 flex gap-2 border-b bg-background py-3">
        <a className={cn(buttonVariants(), "min-h-11")} href="#all">
          全部
        </a>
        <a className={cn(buttonVariants({ variant: "ghost" }), "min-h-11")} href="#track">
          田径
        </a>
      </nav>
      <section aria-labelledby="gallery-heading" className="flex flex-col gap-4 py-4">
        <h2 className="sr-only" id="gallery-heading">
          活动影像
        </h2>
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-[repeat(auto-fit,minmax(176px,1fr))]">
          {galleryPlaceholderIds.map((id) => (
            <div
              aria-hidden="true"
              className="aspect-square rounded-lg border bg-muted"
              data-gallery-placeholder={id}
              key={id}
            />
          ))}
        </div>
      </section>
    </PublicGalleryShell>
  );
}
