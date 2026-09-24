"use client";

import type { AuditLogList, AuditLogView } from "@photostream/contracts";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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

function auditPath(options: {
  readonly cursor?: string | null;
  readonly query: string;
  readonly resultFilter: ResultFilter;
}): string {
  const params = new URLSearchParams({ limit: "60" });
  if (options.cursor) params.set("cursor", options.cursor);
  const query = options.query.trim();
  if (query.length > 0) params.set("q", query);
  if (options.resultFilter !== "all") params.set("result", options.resultFilter);
  return `/api/v1/audit?${params.toString()}`;
}

export function AuditLogTable({ initial }: Readonly<{ initial: AuditLogList }>) {
  const [items, setItems] = useState<readonly AuditLogView[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const firstFilterRender = useRef(true);
  const requestVersion = useRef(0);

  useEffect(() => {
    if (firstFilterRender.current) {
      firstFilterRender.current = false;
      return;
    }
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void clientGet<AuditLogList>(auditPath({ query, resultFilter }), controller.signal)
        .then((page) => {
          if (requestVersion.current !== version) return;
          setItems(page.items);
          setCursor(page.nextCursor);
        })
        .catch((caught) => {
          if (controller.signal.aborted || requestVersion.current !== version) return;
          setError(caught instanceof Error ? caught.message : "审计记录加载失败");
        })
        .finally(() => {
          if (requestVersion.current === version) setPending(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, resultFilter]);

  async function loadMore(): Promise<void> {
    if (cursor === null || pending) return;
    const version = ++requestVersion.current;
    setPending(true);
    setError(null);
    try {
      const page = await clientGet<AuditLogList>(auditPath({ cursor, query, resultFilter }));
      if (requestVersion.current !== version) return;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (caught) {
      if (requestVersion.current !== version) return;
      setError(caught instanceof Error ? caught.message : "审计记录加载失败");
    } finally {
      if (requestVersion.current === version) setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden shadow-none">
        <CardHeader className="gap-3 border-b py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>操作记录</CardTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              已加载 {items.length}
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
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setQuery(value);
                }}
                placeholder="搜索动作、目标或字段"
                value={query} />
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
              {items.length === 0 ? (
                <TableRow>
                  <TableCell className="h-28 text-center text-muted-foreground" colSpan={5}>
                    没有符合条件的记录
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
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
          {pending ? <Spinner className="animate-spin" data-icon="inline-start" /> : null}
          {pending ? "加载中…" : "加载更早记录"}
        </Button>
      )}
      <ErrorDialog message={error} onClose={() => setError(null)} title="无法加载审计记录" />
    </div>
  );
}
