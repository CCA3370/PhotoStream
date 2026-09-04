"use client";

import type { AuditLogList, AuditLogView } from "@photostream/contracts";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorDialog } from "@/components/ui/error-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clientGet } from "@/lib/client-api";

const auditDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Shanghai",
});

export function AuditLogTable({ initial }: Readonly<{ initial: AuditLogList }>) {
  const [items, setItems] = useState<readonly AuditLogView[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>操作记录</CardTitle>
          <CardDescription>
            只保存动作、随机目标 ID、结果和字段摘要；不保存口令、签名 URL 或原始 IP。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>目标</TableHead>
                <TableHead>字段</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{auditDateTimeFormatter.format(new Date(item.createdAt))}</TableCell>
                  <TableCell className="font-mono text-xs">{item.action}</TableCell>
                  <TableCell>
                    <Badge variant={item.result === "success" ? "secondary" : "destructive"}>
                      {item.result}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.targetType} · {item.targetId?.slice(-8) ?? "无"}
                  </TableCell>
                  <TableCell>{item.changedFields.join("、") || "无"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {cursor === null ? null : (
        <Button
          className="self-center"
          disabled={pending}
          onClick={() => void loadMore()}
          type="button"
          variant="outline"
        >
          {pending ? "正在加载…" : "加载更早记录"}
        </Button>
      )}
      <ErrorDialog message={error} onClose={() => setError(null)} title="无法加载审计记录" />
    </div>
  );
}
