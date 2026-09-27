"use client";

import type { AlbumNotificationView } from "@photostream/contracts";
import { BellIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { clientGet, clientMutation } from "@/lib/client-api";

function toBeijingInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function fromBeijingInput(value: string): string | null {
  if (value.trim().length === 0) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatBeijing(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function defaultWindow() {
  const now = new Date();
  return {
    startsAt: toBeijingInput(now),
    endsAt: toBeijingInput(new Date(now.getTime() + 60 * 60 * 1_000)),
  };
}

function statusFor(notification: AlbumNotificationView, now: number) {
  const startsAt = new Date(notification.startsAt).getTime();
  const endsAt = new Date(notification.endsAt).getTime();
  if (now < startsAt) return { label: "未开始", variant: "outline" as const };
  if (now >= endsAt) return { label: "已结束", variant: "secondary" as const };
  return { label: "生效中", variant: "default" as const };
}

export function AlbumNotificationManager({ albumId }: Readonly<{ albumId: string }>) {
  const initialWindow = useMemo(defaultWindow, []);
  const [items, setItems] = useState<readonly AlbumNotificationView[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [startsAt, setStartsAt] = useState(initialWindow.startsAt);
  const [endsAt, setEndsAt] = useState(initialWindow.endsAt);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const result = await clientGet<{ readonly items: readonly AlbumNotificationView[] }>(
        `/api/v1/albums/${albumId}/notifications`,
      );
      setItems(result.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通知列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function createNotification(): Promise<void> {
    if (sending) return;
    const startIso = fromBeijingInput(startsAt);
    const endIso = fromBeijingInput(endsAt);
    if (title.trim().length === 0 || content.trim().length === 0) {
      setError("请填写通知标题和内容");
      return;
    }
    if (startIso === null || endIso === null || new Date(endIso) <= new Date(startIso)) {
      setError("通知结束时间必须晚于开始时间");
      return;
    }

    setSending(true);
    setError(null);
    try {
      const created = await clientMutation<AlbumNotificationView>(
        `/api/v1/albums/${albumId}/notifications`,
        {
          body: {
            title: title.trim(),
            content: content.trim(),
            startsAt: startIso,
            endsAt: endIso,
          },
        },
      );
      setItems((current) => [created, ...current]);
      setTitle("");
      setContent("");
      const nextWindow = defaultWindow();
      setStartsAt(nextWindow.startsAt);
      setEndsAt(nextWindow.endsAt);
      toast.add({ title: "通知已发布", type: "success" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通知发布失败");
    } finally {
      setSending(false);
    }
  }

  async function deleteNotification(notificationId: string): Promise<void> {
    if (deletingIds.has(notificationId)) return;
    setDeletingIds((current) => new Set(current).add(notificationId));
    setError(null);
    try {
      await clientMutation<{ ok: true }>(
        `/api/v1/albums/${albumId}/notifications/${notificationId}`,
        { method: "DELETE" },
      );
      setItems((current) => current.filter((item) => item.id !== notificationId));
      toast.add({ title: "通知已删除", type: "success" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除通知失败");
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(notificationId);
        return next;
      });
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b py-3.5">
          <CardTitle>发布通知</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createNotification();
            }}
          >
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="album-notification-title">标题</FieldLabel>
                <Input
                  id="album-notification-title"
                  maxLength={120}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  placeholder="例如：操场东侧机位调整"
                  required
                  value={title}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="album-notification-content">通知内容</FieldLabel>
                <Textarea
                  className="min-h-32 resize-y"
                  id="album-notification-content"
                  maxLength={4_000}
                  onChange={(event) => setContent(event.currentTarget.value)}
                  placeholder="填写需要向当前活动观众显示的内容。"
                  required
                  value={content}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="album-notification-start">生效时间（北京时间）</FieldLabel>
                  <Input
                    id="album-notification-start"
                    onChange={(event) => setStartsAt(event.currentTarget.value)}
                    required
                    type="datetime-local"
                    value={startsAt}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="album-notification-end">结束时间（北京时间）</FieldLabel>
                  <Input
                    id="album-notification-end"
                    onChange={(event) => setEndsAt(event.currentTarget.value)}
                    required
                    type="datetime-local"
                    value={endsAt}
                  />
                </Field>
              </div>
            </FieldGroup>

            {error === null ? (
              <p className="text-xs leading-5 text-muted-foreground">
                生效期间，新进入活动的观众会看到通知；已打开的直播页也会实时接收。观众可选择不再提示该条通知。
              </p>
            ) : (
              <p className="text-xs font-medium leading-5 text-destructive" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button disabled={sending} type="submit">
                {sending ? (
                  <Spinner className="animate-spin" data-icon="inline-start" />
                ) : (
                  <SendIcon data-icon="inline-start" />
                )}
                {sending ? "发布中" : "发布通知"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b py-3.5">
          <CardTitle>通知记录</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              <Spinner className="mr-2 size-4 animate-spin" />
              正在加载通知
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
              <BellIcon className="size-5" />
              <p className="text-sm">还没有发布过通知</p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((notification) => {
                const status = statusFor(notification, now);
                const deleting = deletingIds.has(notification.id);
                return (
                  <article className="flex gap-3 p-4" key={notification.id}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{notification.title}</p>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {notification.content}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {formatBeijing(notification.startsAt)} — {formatBeijing(notification.endsAt)}
                      </p>
                    </div>
                    <Button
                      aria-label={`删除通知：${notification.title}`}
                      disabled={deleting}
                      onClick={() => void deleteNotification(notification.id)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      {deleting ? <Spinner className="animate-spin" /> : <Trash2Icon />}
                    </Button>
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
