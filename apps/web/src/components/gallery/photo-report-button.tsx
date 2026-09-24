"use client";

import { FlagIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { publicMutation } from "@/lib/client-api";
import type { ViewerReportReason } from "@/lib/viewer-feedback";

const reportReasons: ReadonlyArray<{ readonly value: ViewerReportReason; readonly label: string }> =
  [
    { value: "privacy", label: "侵犯了我的隐私或肖像权" },
    { value: "inappropriate", label: "图片中有不适合公开的内容" },
    { value: "copyright", label: "未经授权使用了我的作品或图片" },
    { value: "inaccurate", label: "图片中的人物或信息有误" },
    { value: "malicious_spread", label: "这张图片被他人恶意传播或扩散" },
    { value: "other", label: "其他需要处理的问题" },
  ];

export function PhotoReportButton({
  className,
  mediaId,
  shareId,
  slug,
}: Readonly<{
  className?: string;
  mediaId: string;
  shareId?: string;
  slug: string;
}>) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ViewerReportReason>("privacy");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    const detail = message.trim();
    if (detail.length < 2 || submitting) return;
    setSubmitting(true);
    try {
      await publicMutation<{ readonly id: number; readonly received: true }>(
        shareId === undefined
          ? `/api/v1/public/albums/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}/report`
          : `/api/v1/public/shares/${encodeURIComponent(shareId)}/report`,
        {
          body: {
            reason,
            message: detail,
            pagePath: `${window.location.pathname}${window.location.search}`.slice(0, 512),
          },
        },
      );
      setOpen(false);
      setMessage("");
      setReason("privacy");
      toast.add({
        title: "投诉已提交",
        description: "管理人员会在后台收到这条投诉并进行处理。",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "提交失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button aria-label="投诉这张图片" className={className} type="button" variant="outline"
      />
        }
      >
        <FlagIcon className="size-4" />
        <span>投诉</span>
      </DialogTrigger>
      <DialogContent
        className="public-theme dark layer-nested-dialog max-w-md bg-background text-foreground"
        forceOverlay
        overlayClassName="layer-nested-dialog-overlay bg-black/55"
      >
        <DialogHeader>
          <DialogTitle>投诉这张图片</DialogTitle>
          <DialogDescription>
            请选择最符合的原因，并补充具体情况。提交内容仅供管理人员处理。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="photo-report-reason">投诉原因</Label>
            <Select
              items={reportReasons}
              onValueChange={(value) => {
                if (
                  value === "privacy" ||
                  value === "inappropriate" ||
                  value === "copyright" ||
                  value === "inaccurate" ||
                  value === "malicious_spread" ||
                  value === "other"
                ) {
                  setReason(value);
                }
              }}
              value={reason}
            >
              <SelectTrigger className="h-11 w-full sm:h-8" id="photo-report-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="start"
                className="w-max min-w-(--anchor-width) max-w-[calc(100vw-2rem)]"
                positionerClassName="layer-nested-popover"
              >
                <SelectGroup>
                  {reportReasons.map((item) => (
                    <SelectItem
                      className="py-2 [&>span:first-child]:min-w-0 [&>span:first-child]:whitespace-normal [&>span:first-child]:leading-5"
                      key={item.value}
                      value={item.value}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="photo-report-detail">具体原因 / 说明</Label>
            <Textarea
              autoFocus
              id="photo-report-detail"
              maxLength={2_000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="请说明需要处理的具体内容，例如涉及哪位同学、哪部分信息或其他情况。"
              rows={5}
              value={message} />
            <p className="text-right text-xs text-muted-foreground">{message.length}/2000</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={submitting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button
            disabled={message.trim().length < 2 || submitting}
            onClick={() => void submit()}
            type="button"
          >
            {submitting ? <Spinner className="animate-spin" data-icon="inline-start" /> : null}
            提交投诉
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
