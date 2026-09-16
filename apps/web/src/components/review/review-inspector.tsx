"use client";

import type { BibMediaState } from "@photostream/contracts";
import {
  BadgeCheckIcon,
  EyeIcon,
  EyeOffIcon,
  HashIcon,
  SendIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { isBibReviewConfirmed } from "@/components/bib/bib-review-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ReviewInspectorCategory {
  readonly id: string;
  readonly name: string;
}

export interface ReviewInspectorItem {
  readonly key: string;
  readonly title: string;
  readonly mediaId: string | null;
  readonly categoryId: string | null;
  readonly uploaderName: string | null;
  readonly sourceLabel: string;
  readonly featured: boolean;
  readonly publicationStatus: string;
  readonly ingestStatus: string;
  readonly width: number;
  readonly height: number;
  readonly totalBytes: number;
  readonly createdAt: string;
  readonly capturedAt: string | null;
  readonly bib: BibMediaState | null;
  readonly canDelete: boolean;
}

export interface ReviewBatchInspectorStats {
  readonly publishable: number;
  readonly hideable: number;
  readonly restorable: number;
  readonly featureable: number;
  readonly unfeatureable: number;
  readonly deletable: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)
    return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function dateTime(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function statusLabel(status: string): string {
  if (status === "published") return "已发布";
  if (status === "hidden") return "已隐藏";
  if (status === "local") return "本机待发布";
  if (status === "pending_review") return "待审核";
  if (status === "draft") return "草稿";
  return status;
}

function stateActionLabel(status: string): string {
  if (status === "published") return "隐藏";
  if (status === "hidden") return "恢复显示";
  return "发布";
}

export function ReviewInspector({
  item,
  categories,
  busy,
  onCategoryChange,
  onClose,
  onDelete,
  onOpenBib,
  onStateAction,
  onToggleFeatured,
}: Readonly<{
  item: ReviewInspectorItem;
  categories: readonly ReviewInspectorCategory[];
  busy: boolean;
  onCategoryChange: (categoryId: string | null) => void;
  onClose: () => void;
  onDelete: () => void;
  onOpenBib: () => void;
  onStateAction: () => void;
  onToggleFeatured: () => void;
}>) {
  const bibConfirmed = isBibReviewConfirmed(item.bib);
  const confirmedNumbers =
    item.bib?.tags
      .filter((tag) => tag.status === "confirmed")
      .map((tag) => tag.number)
      .filter((number, index, values) => values.indexOf(number) === index) ?? [];

  return (
    <aside className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-start gap-3 border-b p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{statusLabel(item.publicationStatus)}</Badge>
            {item.featured ? <Badge variant="secondary">精选</Badge> : null}
            <Badge variant="outline">{item.sourceLabel}</Badge>
          </div>
        </div>
        <Button
          aria-label="关闭属性面板"
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold text-muted-foreground">照片属性</h3>
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              分类
              <Select
                items={[
                  { label: "未分类", value: "uncategorized" },
                  ...categories.map((category) => ({ label: category.name, value: category.id })),
                ]}
                onValueChange={(value) =>
                  onCategoryChange(value === null || value === "uncategorized" ? null : value)
                }
                value={item.categoryId ?? "uncategorized"}
              >
                <SelectTrigger aria-label="修改照片分类" className="w-full">
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
            </label>

            <div className="grid grid-cols-2 gap-2">
              <Button disabled={busy} onClick={onToggleFeatured} type="button" variant="outline">
                <StarIcon
                  className={item.featured ? "fill-current" : undefined}
                  data-icon="inline-start"
                />
                {item.featured ? "取消精选" : "设为精选"}
              </Button>
              <Button disabled={busy} onClick={onStateAction} type="button" variant="outline">
                {item.publicationStatus === "published" ? (
                  <EyeOffIcon data-icon="inline-start" />
                ) : item.publicationStatus === "hidden" ? (
                  <EyeIcon data-icon="inline-start" />
                ) : (
                  <SendIcon data-icon="inline-start" />
                )}
                {stateActionLabel(item.publicationStatus)}
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2.5 border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">号码审核</h3>
              {bibConfirmed ? (
                <Badge variant="secondary">
                  <BadgeCheckIcon />
                  已确认
                </Badge>
              ) : (
                <Badge variant="outline">待复核</Badge>
              )}
            </div>
            {confirmedNumbers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {confirmedNumbers.map((number) => (
                  <Badge key={number} variant="outline">
                    #{number}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {item.bib?.review.decision === "no_number_confirmed"
                  ? "已确认无号码"
                  : "暂无已确认号码"}
              </p>
            )}
            <Button disabled={busy} onClick={onOpenBib} type="button" variant="outline">
              <HashIcon data-icon="inline-start" />
              {bibConfirmed ? "修改号码确认" : "审核号码"}
            </Button>
          </section>

          <section className="border-t pt-4">
            <h3 className="mb-2.5 text-xs font-semibold text-muted-foreground">只读信息</h3>
            <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">上传者</dt>
              <dd className="truncate text-right">{item.uploaderName ?? "本机"}</dd>
              <dt className="text-muted-foreground">尺寸</dt>
              <dd className="text-right tabular-nums">
                {item.width} × {item.height}
              </dd>
              <dt className="text-muted-foreground">文件大小</dt>
              <dd className="text-right tabular-nums">{formatBytes(item.totalBytes)}</dd>
              <dt className="text-muted-foreground">处理状态</dt>
              <dd className="truncate text-right">{item.ingestStatus}</dd>
              <dt className="text-muted-foreground">加入时间</dt>
              <dd className="text-right">{dateTime(item.createdAt)}</dd>
              <dt className="text-muted-foreground">拍摄时间</dt>
              <dd className="text-right">{dateTime(item.capturedAt)}</dd>
              <dt className="text-muted-foreground">媒体 ID</dt>
              <dd className="truncate text-right font-mono text-[10px]">{item.mediaId ?? "—"}</dd>
            </dl>
          </section>

          <section className="border-t pt-4">
            <h3 className="mb-2 text-xs font-semibold text-destructive">危险操作</h3>
            <Button
              className="w-full"
              disabled={busy || !item.canDelete}
              onClick={onDelete}
              type="button"
              variant="destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              删除照片
            </Button>
            {!item.canDelete ? (
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                当前账号无权删除这张远端照片。
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </aside>
  );
}

export function ReviewBatchInspector({
  count,
  stats,
  categories,
  categoryValue,
  bibEnabled,
  bibNumber,
  busy,
  onCategoryValueChange,
  onApplyCategory,
  onBibNumberChange,
  onPublish,
  onHide,
  onRestore,
  onFeature,
  onUnfeature,
  onAddBibNumber,
  onConfirmNoNumber,
  onDelete,
  onExit,
}: Readonly<{
  count: number;
  stats: ReviewBatchInspectorStats;
  categories: readonly ReviewInspectorCategory[];
  categoryValue: string;
  bibEnabled: boolean;
  bibNumber: string;
  busy: boolean;
  onCategoryValueChange: (value: string) => void;
  onApplyCategory: () => void;
  onBibNumberChange: (value: string) => void;
  onPublish: () => void;
  onHide: () => void;
  onRestore: () => void;
  onFeature: () => void;
  onUnfeature: () => void;
  onAddBibNumber: () => void;
  onConfirmNoNumber: () => void;
  onDelete: () => void;
  onExit: () => void;
}>) {
  const categoryItems = [
    ...(categoryValue === "mixed" ? [{ label: "多个值", value: "mixed" }] : []),
    { label: "未分类", value: "uncategorized" },
    ...categories.map((category) => ({ label: category.name, value: category.id })),
  ];

  return (
    <aside className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-start gap-3 border-b p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">批量属性</p>
          <p className="mt-1 text-xs text-muted-foreground">已选择 {count} 张照片</p>
        </div>
        <Button aria-label="退出批量选择" onClick={onExit} size="icon-sm" type="button" variant="ghost">
          <XIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold text-muted-foreground">发布状态</h3>
            <div className="grid grid-cols-3 gap-2">
              <Button disabled={busy || stats.publishable === 0} onClick={onPublish} type="button" variant="outline">
                <SendIcon data-icon="inline-start" />
                发布 {stats.publishable}
              </Button>
              <Button disabled={busy || stats.hideable === 0} onClick={onHide} type="button" variant="outline">
                <EyeOffIcon data-icon="inline-start" />
                隐藏 {stats.hideable}
              </Button>
              <Button disabled={busy || stats.restorable === 0} onClick={onRestore} type="button" variant="outline">
                <EyeIcon data-icon="inline-start" />
                恢复 {stats.restorable}
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2.5 border-t pt-4">
            <h3 className="text-xs font-semibold text-muted-foreground">属性</h3>
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              分类
              <div className="flex gap-2">
                <Select
                  items={categoryItems}
                  onValueChange={(value) => onCategoryValueChange(value ?? "mixed")}
                  value={categoryValue}
                >
                  <SelectTrigger aria-label="批量修改分类" className="min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {categoryValue === "mixed" ? (
                        <SelectItem disabled value="mixed">
                          多个值
                        </SelectItem>
                      ) : null}
                      <SelectItem value="uncategorized">未分类</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button disabled={busy || categoryValue === "mixed"} onClick={onApplyCategory} type="button" variant="outline">
                  应用
                </Button>
              </div>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={busy || stats.featureable === 0} onClick={onFeature} type="button" variant="outline">
                <StarIcon data-icon="inline-start" />
                精选 {stats.featureable}
              </Button>
              <Button disabled={busy || stats.unfeatureable === 0} onClick={onUnfeature} type="button" variant="outline">
                <StarIcon data-icon="inline-start" />
                取消 {stats.unfeatureable}
              </Button>
            </div>
          </section>

          {bibEnabled ? (
            <section className="flex flex-col gap-2.5 border-t pt-4">
              <h3 className="text-xs font-semibold text-muted-foreground">号码审核</h3>
              <div className="flex gap-2">
                <Input
                  aria-label="批量添加统一号码"
                  disabled={busy}
                  inputMode="numeric"
                  maxLength={12}
                  onChange={(event) => onBibNumberChange(event.currentTarget.value)}
                  placeholder="统一号码"
                  value={bibNumber}
                />
                <Button disabled={busy || bibNumber.trim().length === 0} onClick={onAddBibNumber} type="button" variant="outline">
                  添加
                </Button>
              </div>
              <Button disabled={busy} onClick={onConfirmNoNumber} type="button" variant="outline">
                <HashIcon data-icon="inline-start" />
                批量确认无号码
              </Button>
            </section>
          ) : null}

          <section className="border-t pt-4">
            <h3 className="mb-2 text-xs font-semibold text-destructive">危险操作</h3>
            <Button
              className="w-full"
              disabled={busy || stats.deletable === 0}
              onClick={onDelete}
              type="button"
              variant="destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              删除 {stats.deletable} 张
            </Button>
            {count > stats.deletable ? (
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                另有 {count - stats.deletable} 张因权限或状态限制不会删除。
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </aside>
  );
}
