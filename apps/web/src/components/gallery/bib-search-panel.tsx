"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { SearchIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useState } from "react";

import type { FaceSearchPanelProps } from "@/components/gallery/face-search-launcher";
import { FaceSearchLauncher } from "@/components/gallery/face-search-launcher";
import { MediaGrid } from "@/components/gallery/media-grid";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { publicMutation } from "@/lib/client-api";

interface SearchPage {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

interface AttributeOption {
  readonly id: string;
  readonly dimension: "grade" | "class";
  readonly displayName: string;
  readonly sortOrder: number;
}

interface AttributePair {
  readonly gradeOptionId: string;
  readonly classOptionId: string | null;
}

type SearchMode = "attributes" | "face" | "number";

type FaceSearchOptions = Readonly<Omit<FaceSearchPanelProps, "onClose">>;

export function BibSearchPanel({
  attributeFilterEnabled,
  attributeOptions,
  attributePairs,
  bibSearchEnabled = true,
  categoryId,
  children,
  faceSearch,
  numberLengths,
  slug,
}: Readonly<{
  attributeFilterEnabled: boolean;
  attributeOptions: readonly AttributeOption[];
  attributePairs: readonly AttributePair[];
  bibSearchEnabled?: boolean;
  categoryId?: string;
  children: ReactNode;
  faceSearch?: FaceSearchOptions;
  numberLengths: readonly number[];
  slug: string;
}>) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<SearchMode>(bibSearchEnabled ? "number" : "face");
  const [number, setNumber] = useState("");
  const [gradeOptionId, setGradeOptionId] = useState<string | null>(null);
  const [classOptionId, setClassOptionId] = useState<string | null>(null);
  const [result, setResult] = useState<SearchPage | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gradeOptions = attributeOptions.filter((option) => option.dimension === "grade");
  const allowedClassIds = new Set(
    attributePairs.flatMap((pair) =>
      pair.gradeOptionId === gradeOptionId && pair.classOptionId !== null
        ? [pair.classOptionId]
        : [],
    ),
  );
  const classOptions = attributeOptions.filter(
    (option) => option.dimension === "class" && allowedClassIds.has(option.id),
  );
  const numberPlaceholder =
    numberLengths.length === 0
      ? "输入完整号码"
      : `输入号码（${numberLengths.map((length) => `${length} 位`).join("或")}）`;

  function clearSearchResult(): void {
    setResult(null);
    setError(null);
  }

  async function search(cursor?: string): Promise<void> {
    if (pending || mode === "face") return;
    if (mode === "number" && number.length === 0) return;
    if (mode === "attributes" && gradeOptionId === null) return;
    setPending(true);
    setError(null);
    try {
      const page =
        mode === "number"
          ? await publicMutation<SearchPage>(`/api/v1/public/albums/${slug}/bib-search`, {
              body: { number, ...(cursor === undefined ? {} : { cursor }) },
            })
          : await publicMutation<SearchPage>(
              `/api/v1/public/albums/${slug}/bib-attributes-filter`,
              {
                body: {
                  gradeOptionId,
                  ...(classOptionId === null ? {} : { classOptionId }),
                  ...(categoryId === undefined ? {} : { categoryId }),
                  ...(cursor === undefined ? {} : { cursor }),
                },
              },
            );
      setResult((current) => {
        if (cursor === undefined || current === null) return page;
        const byId = new Map(current.items.map((item) => [item.id, item]));
        for (const item of page.items) byId.set(item.id, item);
        return { ...page, items: [...byId.values()] };
      });
      if (cursor === undefined) setExpanded(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "查找失败");
      if (cursor === undefined) setResult({ items: [], nextCursor: null, eventCursor: 0 });
    } finally {
      setPending(false);
    }
  }

  const refreshCurrentSearch = useEffectEvent(() => {
    void search();
  });
  const hasSearchResult = result !== null;

  useEffect(() => {
    if (!hasSearchResult) return;
    const refresh = () => refreshCurrentSearch();
    window.addEventListener("photostream:bib-updated", refresh);
    window.addEventListener("photostream:media-published", refresh);
    return () => {
      window.removeEventListener("photostream:bib-updated", refresh);
      window.removeEventListener("photostream:media-published", refresh);
    };
  }, [hasSearchResult]);

  function changeMode(nextMode: SearchMode): void {
    setMode(nextMode);
    if (nextMode === "number") {
      setGradeOptionId(null);
      setClassOptionId(null);
    } else if (nextMode === "attributes") {
      setNumber("");
    }
    clearSearchResult();
  }

  function clearAll(): void {
    setResult(null);
    setError(null);
    setNumber("");
    setGradeOptionId(null);
    setClassOptionId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          aria-expanded={expanded}
          className="rounded-full"
          onClick={() => setExpanded((current) => !current)}
          size="sm"
          type="button"
          variant="outline"
        >
          <SearchIcon data-icon="inline-start" />
          找照片
        </Button>
        {result === null ? null : (
          <Button className="rounded-full" onClick={clearAll} size="sm" type="button" variant="ghost">
            <XIcon data-icon="inline-start" />
            清除
          </Button>
        )}
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-card/50 p-3 sm:max-w-xl sm:p-4">
          <ToggleGroup
            aria-label="找照片方式"
            onValueChange={(values) => {
              const value = values[0];
              if (value === "number" || value === "attributes" || value === "face") {
                changeMode(value);
              }
            }}
            spacing={2}
            value={[mode]}
          >
            {bibSearchEnabled ? <ToggleGroupItem value="number">号码</ToggleGroupItem> : null}
            {bibSearchEnabled && attributeFilterEnabled ? (
              <ToggleGroupItem value="attributes">年级班级</ToggleGroupItem>
            ) : null}
            {faceSearch === undefined ? null : (
              <ToggleGroupItem value="face">人脸</ToggleGroupItem>
            )}
          </ToggleGroup>

          {mode === "number" && bibSearchEnabled ? (
            <Field>
              <FieldLabel className="sr-only" htmlFor="public-bib-number">
                输入号码找照片
              </FieldLabel>
              <Input
                autoComplete="off"
                id="public-bib-number"
                inputMode="numeric"
                maxLength={12}
                onChange={(event) => {
                  setNumber(event.currentTarget.value);
                  clearSearchResult();
                }}
                placeholder={numberPlaceholder}
                value={number}
              />
            </Field>
          ) : null}

          {mode === "attributes" && bibSearchEnabled && attributeFilterEnabled ? (
            <FieldGroup className="flex flex-col gap-3 sm:flex-row">
              <Field>
                <FieldLabel htmlFor="public-bib-grade">年级</FieldLabel>
                <Select
                  items={gradeOptions.map((option) => ({
                    value: option.id,
                    label: option.displayName,
                  }))}
                  onValueChange={(value) => {
                    setGradeOptionId(typeof value === "string" ? value : null);
                    setClassOptionId(null);
                    clearSearchResult();
                  }}
                  value={gradeOptionId}
                >
                  <SelectTrigger className="min-h-10" id="public-bib-grade">
                    <SelectValue>
                      {(value) =>
                        value === null
                          ? "选择年级"
                          : (gradeOptions.find((option) => option.id === value)?.displayName ??
                            "选择年级")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {gradeOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.displayName}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field data-disabled={gradeOptionId === null || undefined}>
                <FieldLabel htmlFor="public-bib-class">班级</FieldLabel>
                <Select
                  disabled={gradeOptionId === null}
                  items={[
                    { value: "all", label: "全部班级" },
                    ...classOptions.map((option) => ({
                      value: option.id,
                      label: option.displayName,
                    })),
                  ]}
                  onValueChange={(value) => {
                    setClassOptionId(typeof value === "string" && value !== "all" ? value : null);
                    clearSearchResult();
                  }}
                  value={classOptionId ?? "all"}
                >
                  <SelectTrigger className="min-h-10" id="public-bib-class">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">全部班级</SelectItem>
                      {classOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.displayName}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          ) : null}

          {mode === "face" && faceSearch !== undefined ? (
            <FaceSearchLauncher {...faceSearch} />
          ) : null}

          {mode === "face" ? null : (
            <Button
              className="w-fit"
              disabled={
                pending || (mode === "number" ? number.length === 0 : gradeOptionId === null)
              }
              onClick={() => void search()}
              size="sm"
              type="button"
            >
              <SearchIcon data-icon="inline-start" />
              {pending ? "查找中…" : "查找"}
            </Button>
          )}
        </div>
      ) : null}

      {error === null ? null : (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {result === null ? (
        children
      ) : (
        <section aria-label="照片查找结果" className="flex flex-col gap-4">
          {result.items.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              没有匹配照片
            </div>
          ) : (
            <>
              <p aria-live="polite" className="text-sm text-muted-foreground">
                找到 {result.items.length} 张照片
              </p>
              <MediaGrid items={result.items} slug={slug} />
            </>
          )}
          {result.nextCursor === null ? null : (
            <Button
              className="self-center"
              disabled={pending}
              onClick={() => void search(result.nextCursor ?? undefined)}
              size="sm"
              type="button"
              variant="outline"
            >
              加载更多
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
