"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { SearchIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useState } from "react";

import { MediaGrid } from "@/components/gallery/media-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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

export function BibSearchPanel({
  attributeFilterEnabled,
  attributeOptions,
  attributePairs,
  categoryId,
  children,
  numberLengths,
  slug,
}: Readonly<{
  attributeFilterEnabled: boolean;
  attributeOptions: readonly AttributeOption[];
  attributePairs: readonly AttributePair[];
  categoryId?: string;
  children: ReactNode;
  numberLengths: readonly number[];
  slug: string;
}>) {
  const [mode, setMode] = useState<"attributes" | "number">("number");
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
      : `支持 ${numberLengths.map((length) => `${length} 位`).join("或")}`;

  function clearSearchResult(): void {
    setResult(null);
    setError(null);
  }

  async function search(cursor?: string): Promise<void> {
    if (pending) return;
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "号码搜索失败");
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

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>找照片</CardTitle>
          <CardDescription>
            只返回人工确认且已发布的照片；号码不会写入网址或浏览器持久存储。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ToggleGroup
            aria-label="找照片方式"
            onValueChange={(values) => {
              const value = values[0];
              if (value === "number" || value === "attributes") {
                setMode(value);
                if (value === "number") {
                  setGradeOptionId(null);
                  setClassOptionId(null);
                } else {
                  setNumber("");
                }
                clearSearchResult();
              }
            }}
            spacing={2}
            value={[mode]}
          >
            <ToggleGroupItem value="number">按号码</ToggleGroupItem>
            <ToggleGroupItem disabled={!attributeFilterEnabled} value="attributes">
              按年级班级
            </ToggleGroupItem>
          </ToggleGroup>

          {mode === "number" ? (
            <Field>
              <FieldLabel htmlFor="public-bib-number">输入号码找照片</FieldLabel>
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
          ) : (
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
                  <SelectTrigger className="min-h-11" id="public-bib-grade">
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
                  <SelectTrigger className="min-h-11" id="public-bib-class">
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
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                pending || (mode === "number" ? number.length === 0 : gradeOptionId === null)
              }
              onClick={() => void search()}
              type="button"
            >
              <SearchIcon data-icon="inline-start" />
              {pending ? "正在查找…" : "查找照片"}
            </Button>
            {result === null ? null : (
              <Button
                onClick={() => {
                  setResult(null);
                  setError(null);
                  setNumber("");
                  setGradeOptionId(null);
                  setClassOptionId(null);
                }}
                type="button"
                variant="ghost"
              >
                <XIcon data-icon="inline-start" />
                清除筛选
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>没有找到照片</AlertTitle>
          <AlertDescription>请检查号码或筛选条件；空结果不会透露号码是否存在。</AlertDescription>
        </Alert>
      )}

      {result === null ? (
        children
      ) : (
        <section aria-label="号码筛选结果" className="flex flex-col gap-4">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            当前已加载 {result.items.length} 张匹配照片
          </p>
          {result.items.length === 0 ? (
            <Empty className="min-h-64 border">
              <EmptyHeader>
                <EmptyTitle>没有匹配照片</EmptyTitle>
                <EmptyDescription>无匹配、未发布匹配和号码不存在使用相同空结果。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <MediaGrid items={result.items} slug={slug} />
          )}
          {result.nextCursor === null ? null : (
            <Button
              className="self-center"
              disabled={pending}
              onClick={() => void search(result.nextCursor ?? undefined)}
              type="button"
              variant="outline"
            >
              加载更多匹配照片
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
