"use client";

import type { AuditLogList, AuditLogView } from "@photostream/contracts";
import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clientGet } from "@/lib/client-api";

type ResultFilter = "all" | "failed" | "success";

const auditDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Shanghai",
});

export function AuditLogTable({ initial }: Readonly<{ initial: AuditLogList }>) {
  const [items, setItems] = useState<readonly AuditLogView[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return items.filter((item) => {
      if (resultFilter === "success" && item.result !== "success") return false;
      if (resultFilter === "failed" && item.result === "success") return false;
      if (normalizedQuery.length === 0) return true;
      return [item.action, item.targetType, item.targetId ?? "", ...item.changedFields]
        .join("\n")
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedQuery);
    });
  }, [items, query, resultFilter]);

  async function loadMore(): Promise<void> {
    if (cursor === null || pending) return;
    setPending(true);
    setError(null);
    try {
      const page = await clientGet<AuditLogList>(
        `/api/v1/audit?limit=60&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审计记录加载失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden shadow-none">
        <CardHeader className="gap-3 border-b py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>操作记录</CardTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              {visibleItems.length}/{items.length}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1 rounded-lg bg-muted/45 p-1">
              {(["all", "success", "failed"] as const).map((value) => (
                <Button
                  aria-pressed={resultFilter === value}
                  key={value}
                  onClick={() => setResultFilter(value)}
                  size="sm"
                  type="button"
                  variant={resultFilter === value ? "secondary" : "ghost"}
                >
                  {value === "all" ? "全部" : value === "success" ? "成功" : "失败"}
                </Button>
              ))}
            </div>
            <div className="relative sm:w-64">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="搜索审计记录"
                className="h-8 pr-8 pl-8"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索动作、目标或字段"
                value={query}
              />
              {query.length > 0 ? (
                <Button
                  aria-label="清除搜索"
                  className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
                  onClick={() => setQuery("")}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <XIcon aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="pl-4">时间</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>目标</TableHead>
                <TableHead className="pr-4">字段</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell className="h-28 text-center text-muted-foreground" colSpan={5}>
                    没有符合条件的记录
                  </TableCell>
                </TableRow>
              ) : (
                visibleItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="pl-4 text-xs tabular-nums text-muted-foreground">
                      {auditDateTimeFormatter.format(new Date(item.createdAt))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.action}</TableCell>
                    <TableCell>
                      <Badge variant={item.result === "success" ? "secondary" : "destructive"}>
                        {item.result === "success" ? "成功" : item.result}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.targetType} · {item.targetId?.slice(-8) ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-80 truncate pr-4 text-xs text-muted-foreground">
                      {item.changedFields.join("、") || "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {cursor === null ? null : (
        <Button
          className="self-center"
          disabled={pending}
          onClick={() => void loadMore()}
          size="sm"
          type="button"
          variant="outline"
        >
          {pending ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : null}
          {pending ? "加载中…" : "加载更早记录"}
        </Button>
      )}
      <ErrorDialog message={error} onClose={() => setError(null)} title="无法加载审计记录" />
    </div>
  );
}
