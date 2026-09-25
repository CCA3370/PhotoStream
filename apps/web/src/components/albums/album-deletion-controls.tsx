"use client";

import type { AlbumDeletionErrorList, AlbumDeletionErrorView } from "@photostream/contracts";
import { AlertTriangleIcon, HistoryIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { clientGet, clientMutation } from "@/lib/client-api";
import { cn } from "@/lib/utils";

const sourceLabels: Record<AlbumDeletionErrorView["source"], string> = {
  object_storage: "对象存储",
  cdn: "CDN",
  face_provider: "人脸云端服务",
  face_reference: "人脸参考照",
};

const stageLabels: Record<AlbumDeletionErrorView["stage"], string> = {
  object_cleanup: "对象存储 / CDN 清理",
  face_cleanup: "人脸资源清理",
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Asia/Shanghai",
});

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function DetailRow({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string | number | null; mono?: boolean }>) {
  return (
    <div className="grid gap-1 border-b py-2.5 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words text-sm", mono && "font-mono text-xs")}>
        {value === null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

export function AlbumDeletionControls({
  albumId,
  onRetried,
}: Readonly<{
  albumId: string;
  onRetried: () => void;
}>) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AlbumDeletionErrorView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const selected = useMemo(
    () => history.find((item) => item.id === selectedId) ?? history[0] ?? null,
    [history, selectedId],
  );

  const loadHistory = useCallback(async (): Promise<void> => {
    setHistoryLoading(true);
    try {
      const result = await clientGet<AlbumDeletionErrorList>(
        `/api/v1/albums/${albumId}/deletion/errors`,
      );
      setHistory(result.items);
      setSelectedId((current) =>
        current !== null && result.items.some((item) => item.id === current)
          ? current
          : (result.items[0]?.id ?? null),
      );
    } catch (error) {
      toast.add({
        title: "无法读取删除错误记录",
        description: error instanceof Error ? error.message : "请稍后重试。",
        type: "error",
      });
    } finally {
      setHistoryLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    if (!historyOpen) return;
    void loadHistory();
  }, [historyOpen, loadHistory]);

  async function retryNow(): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    try {
      await clientMutation<{ ok: true }>(`/api/v1/albums/${albumId}/deletion/retry`);
      toast.add({
        title: "已触发删除重试",
        description: "系统已立即重试当前可安全执行的清理步骤。",
        type: "success",
      });
      onRetried();
      if (historyOpen) await loadHistory();
    } catch (error) {
      toast.add({
        title: "暂时无法触发重试",
        description: error instanceof Error ? error.message : "请稍后再试。",
        type: "error",
      });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={retrying} onClick={() => void retryNow()} size="sm" type="button">
          {retrying ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
          {retrying ? "重试中" : "立即重试"}
        </Button>
        <Button onClick={() => setHistoryOpen(true)} size="sm" type="button" variant="outline">
          <HistoryIcon aria-hidden="true" />
          查看全部错误
        </Button>
      </div>

      <Dialog onOpenChange={setHistoryOpen} open={historyOpen}>
        <DialogContent className="h-[min(760px,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>删除错误历史</DialogTitle>
            <DialogDescription>
              左侧选择一次失败，右侧显示该次错误保存的完整诊断信息。
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 md:grid-cols-[19rem_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto border-b bg-muted/20 p-2 md:border-r md:border-b-0">
              {historyLoading && history.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  正在读取错误记录
                </div>
              ) : history.length === 0 ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-center">
                  <HistoryIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">暂无历史错误</p>
                  <p className="text-xs text-muted-foreground">删除流程目前没有保存到失败记录。</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {history.map((item) => (
                    <button
                      className={cn(
                        "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                        selected?.id === item.id
                          ? "border-foreground/20 bg-background"
                          : "border-transparent hover:bg-background/70",
                      )}
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium">{sourceLabels[item.source]}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {formatDateTime(item.occurredAt)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs">{item.operation}</p>
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                        {item.code ?? "无错误代码"} · 第 {item.attempt} 次
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 overflow-y-auto p-5">
              {selected === null ? (
                <div className="grid min-h-full place-items-center text-sm text-muted-foreground">
                  选择左侧错误查看详情
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                  <div className="flex gap-3 rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-100">
                    <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {sourceLabels[selected.source]} · {selected.operation}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                        {selected.message}
                      </p>
                    </div>
                  </div>

                  <dl className="rounded-lg border px-3">
                    <DetailRow label="发生时间" value={formatDateTime(selected.occurredAt)} />
                    <DetailRow label="删除阶段" value={stageLabels[selected.stage]} />
                    <DetailRow label="错误来源" value={sourceLabels[selected.source]} />
                    <DetailRow label="操作" mono value={selected.operation} />
                    <DetailRow label="错误代码" mono value={selected.code} />
                    <DetailRow label="HTTP 状态" value={selected.httpStatus} />
                    <DetailRow
                      label="Provider Request ID"
                      mono
                      value={selected.providerRequestId}
                    />
                    <DetailRow label="尝试次数" value={selected.attempt} />
                    <DetailRow label="记录 ID" mono value={selected.id} />
                  </dl>

                  <div className="rounded-lg border">
                    <div className="border-b px-3 py-2 text-xs font-medium">完整附加信息</div>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-5">
                      {JSON.stringify(selected.details, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
