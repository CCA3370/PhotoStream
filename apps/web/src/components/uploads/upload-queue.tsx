"use client";

import { ImagePlusIcon, Trash2Icon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createLocalReviewPhoto,
  deleteLocalReviewPhoto,
  type LocalReviewPhoto,
  listLocalReviewPhotos,
  localQueueSupported,
  putLocalReviewPhoto,
} from "@/lib/local-review-queue";
import { processPhotoInWorker } from "@/lib/photo-processing";
import { cn } from "@/lib/utils";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

interface PreviewPhoto {
  readonly photo: LocalReviewPhoto;
  readonly url: string;
}

export function UploadQueue({
  albumId,
  categories,
  role,
}: Readonly<{
  albumId: string;
  albumTitle: string;
  categories: readonly CategoryOption[];
  role: "admin" | "uploader";
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);
  const [categoryId, setCategoryId] = useState("uncategorized");
  const [items, setItems] = useState<readonly PreviewPhoto[]>([]);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listLocalReviewPhotos(albumId);
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    const next = rows.map((photo) => {
      const preview =
        photo.variants.find((variant) => variant.kind === "photo_480")?.blob ?? photo.originalBlob;
      return { photo, url: URL.createObjectURL(preview) };
    });
    previewUrls.current = next.map((item) => item.url);
    setItems(next);
  }, [albumId]);

  useEffect(() => {
    void refresh();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly albumId?: string }>).detail;
      if (detail?.albumId === albumId) void refresh();
    };
    window.addEventListener("photostream:local-review-changed", changed);
    return () => {
      window.removeEventListener("photostream:local-review-changed", changed);
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current = [];
    };
  }, [albumId, refresh]);

  async function stage(files: readonly File[]): Promise<void> {
    if (files.length === 0 || processing) return;
    if (!localQueueSupported()) {
      setMessage("当前浏览器不支持本地审核队列");
      return;
    }
    if (files.length > 200) {
      setMessage("单次最多选择 200 张照片");
      return;
    }
    setProcessing(true);
    setMessage(null);
    let completed = 0;
    try {
      for (const file of files) {
        try {
          const processed = await processPhotoInWorker(file);
          await putLocalReviewPhoto(
            createLocalReviewPhoto({
              albumId,
              categoryId: categoryId === "uncategorized" ? null : categoryId,
              file,
              processed,
            }),
          );
          completed += 1;
        } catch (error) {
          setMessage(`${file.name}：${error instanceof Error ? error.message : "本地处理失败"}`);
        }
      }
      if (completed > 0) setMessage(`已加入本地审核队列 ${completed} 张`);
      await refresh();
    } finally {
      setProcessing(false);
      if (inputRef.current !== null) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={[
            { label: "未分类", value: "uncategorized" },
            ...categories.map((category) => ({ label: category.name, value: category.id })),
          ]}
          onValueChange={(value) => setCategoryId(value ?? "uncategorized")}
          value={categoryId}
        >
          <SelectTrigger className="h-9 w-36" aria-label="选择分类">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="uncategorized">未分类</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          disabled={processing}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
        >
          <ImagePlusIcon data-icon="inline-start" />
          {processing ? "正在本地处理…" : "选择图片"}
        </Button>
        {role === "admin" ? (
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href={`/studio/albums/${albumId}/review`}
          >
            前往审核
          </Link>
        ) : null}
        <span className="text-xs text-muted-foreground">本地待审核 {items.length} 张</span>
      </div>

      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        multiple
        onChange={(event) => void stage(Array.from(event.currentTarget.files ?? []))}
        ref={inputRef}
        type="file"
      />

      <button
        className={cn(
          "flex min-h-32 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "bg-muted/15 hover:bg-muted/30",
        )}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void stage(Array.from(event.dataTransfer.files));
        }}
        type="button"
      >
        <ImagePlusIcon className="size-5 text-muted-foreground" />
        <span className="text-sm font-medium">拖入图片或点击选择</span>
        <span className="text-xs text-muted-foreground">
          原图仅保存在当前浏览器；审核页点击发布后才上传至 OSS
        </span>
      </button>

      {message === null ? null : <p className="text-xs text-muted-foreground">{message}</p>}

      {items.length === 0 ? null : (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-7 2xl:grid-cols-9">
          {items.map(({ photo, url }) => (
            <div
              className="group relative aspect-square overflow-hidden rounded-md bg-muted"
              key={photo.id}
            >
              <Image
                alt="本地待审核图片"
                className="object-cover"
                fill
                sizes="160px"
                src={url}
                unoptimized
              />
              <Button
                aria-label="从本地队列删除"
                className="absolute right-1 top-1 size-7 opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => void deleteLocalReviewPhoto(photo.id)}
                size="icon"
                type="button"
                variant="destructive"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
