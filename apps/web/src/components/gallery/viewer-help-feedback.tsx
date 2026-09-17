"use client";

import {
  BookOpenCheckIcon,
  CircleHelpIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { publicMutation } from "@/lib/client-api";
import { viewerOnboardingStorageKey } from "@/lib/viewer-onboarding";

const helpTipStorageKey = "photostream:viewer-help-feedback-tip:v1";

const feedbackKinds = [
  { value: "problem", label: "遇到问题" },
  { value: "suggestion", label: "建议" },
  { value: "other", label: "其他" },
] as const;

type FeedbackKind = (typeof feedbackKinds)[number]["value"];

function storageSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "seen";
  } catch {
    return false;
  }
}

function markStorageSeen(key: string): void {
  try {
    window.localStorage.setItem(key, "seen");
  } catch {
    // The help remains usable when browser storage is unavailable.
  }
}

export function ViewerHelpFeedback({ slug }: Readonly<{ slug: string }>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [guideTipOpen, setGuideTipOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("suggestion");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (storageSeen(helpTipStorageKey)) return;

    const revealWhenOnboardingFinishes = () => {
      if (!storageSeen(viewerOnboardingStorageKey)) return;
      window.setTimeout(() => setGuideTipOpen(true), 180);
      window.clearInterval(timer);
    };
    const timer = window.setInterval(revealWhenOnboardingFinishes, 250);
    revealWhenOnboardingFinishes();
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  function dismissGuideTip(): void {
    markStorageSeen(helpTipStorageKey);
    setGuideTipOpen(false);
  }

  function replayGuide(): void {
    dismissGuideTip();
    setMenuOpen(false);
    document.querySelector<HTMLButtonElement>('button[aria-label="重新查看使用引导"]')?.click();
  }

  async function submitFeedback(): Promise<void> {
    const trimmed = message.trim();
    if (trimmed.length < 2 || submitting) return;

    setSubmitting(true);
    try {
      const pagePath = `${window.location.pathname}${window.location.search}`.slice(0, 512);
      await publicMutation<{ readonly id: number; readonly received: true }>(
        `/api/v1/public/albums/${encodeURIComponent(slug)}/feedback`,
        {
          body: { kind, message: trimmed, pagePath },
        },
      );
      setMessage("");
      setKind("suggestion");
      setFeedbackOpen(false);
      toast.add({
        title: "反馈已发送",
        description: "谢谢你的反馈，我们会尽快查看并处理。",
        type: "success",
        timeout: 4_500,
      });
    } catch (error) {
      toast.add({
        title: "暂时发送失败",
        description: error instanceof Error ? error.message : "请稍后再试。",
        type: "error",
        timeout: 5_000,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        className="fixed right-2.5 bottom-[calc(2.5rem+env(safe-area-inset-bottom))] z-30 sm:right-4"
        ref={menuRef}
      >
        {guideTipOpen && !menuOpen ? (
          <section
            aria-live="polite"
            className="absolute right-0 bottom-11 w-[min(18rem,calc(100vw-1.25rem))] rounded-2xl border border-border/80 bg-background/98 p-3.5 shadow-xl shadow-black/10 backdrop-blur-xl"
          >
            <p className="text-xs font-medium text-primary">使用引导 · 最后一步</p>
            <p className="mt-1 text-sm font-semibold">帮助与反馈都在这里</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              点击右下角问号，可以随时重新查看使用引导，也可以把遇到的问题或建议告诉我们。我们会尽快看到你的反馈，有些问题最快约
              10 分钟就能看到变化。
            </p>
            <div className="mt-3 flex justify-end">
              <Button onClick={dismissGuideTip} size="sm" type="button">
                知道了
              </Button>
            </div>
            <span
              aria-hidden="true"
              className="absolute right-3.5 -bottom-1.5 size-3 rotate-45 border-r border-b border-border/80 bg-background"
            />
          </section>
        ) : null}

        {menuOpen ? (
          <section
            aria-label="帮助与反馈"
            className="absolute right-0 bottom-10 w-[min(17rem,calc(100vw-1.25rem))] rounded-2xl border border-border/80 bg-background/96 p-2 shadow-xl shadow-black/10 backdrop-blur-xl"
          >
            <div className="px-2.5 pt-2 pb-1.5">
              <p className="text-sm font-semibold">帮助与反馈</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                查看功能介绍，或把使用中的问题和想法告诉我们。
              </p>
            </div>
            <div className="grid gap-1">
              <Button
                className="h-auto justify-start gap-3 rounded-xl px-2.5 py-2.5 text-left"
                onClick={replayGuide}
                type="button"
                variant="ghost"
              >
                <BookOpenCheckIcon className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">使用引导</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    重新了解浏览、找照片等功能
                  </span>
                </span>
              </Button>
              <Button
                className="h-auto justify-start gap-3 rounded-xl px-2.5 py-2.5 text-left"
                onClick={() => {
                  dismissGuideTip();
                  setMenuOpen(false);
                  setFeedbackOpen(true);
                }}
                type="button"
                variant="ghost"
              >
                <MessageSquareTextIcon className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">提交反馈</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    遇到问题或有建议，随时告诉我们
                  </span>
                </span>
              </Button>
            </div>
          </section>
        ) : null}

        <Button
          aria-expanded={menuOpen}
          aria-label="帮助与反馈"
          className="size-8 rounded-full bg-background/82 p-0 text-muted-foreground shadow-sm backdrop-blur-md hover:text-foreground"
          data-viewer-help-trigger
          onClick={() => {
            dismissGuideTip();
            setMenuOpen((open) => !open);
          }}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <CircleHelpIcon className="size-3.5" />
        </Button>
      </div>

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="public-theme sm:max-w-md">
          <DialogHeader>
            <DialogTitle>告诉我们你的想法</DialogTitle>
            <DialogDescription>
              我们会尽快看到你的反馈并及时处理，有些问题最快约 10 分钟就能看到变化。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">反馈类型</legend>
              {feedbackKinds.map((item) => (
                <Button
                  aria-pressed={kind === item.value}
                  key={item.value}
                  onClick={() => setKind(item.value)}
                  size="sm"
                  type="button"
                  variant={kind === item.value ? "default" : "outline"}
                >
                  {item.label}
                </Button>
              ))}
            </fieldset>

            <div className="grid gap-1.5">
              <Textarea
                autoFocus
                maxLength={2_000}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="例如：切换照片时有点卡；希望增加……"
                rows={5}
                value={message}
              />
              <div className="flex items-start justify-between gap-3 text-[11px] leading-5 text-muted-foreground">
                <p>我们只会记录你当前所在的页面，方便了解问题，不会收集额外的设备信息。</p>
                <span className="shrink-0 tabular-nums">{message.length}/2000</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              disabled={submitting}
              onClick={() => setFeedbackOpen(false)}
              type="button"
              variant="ghost"
            >
              取消
            </Button>
            <Button
              disabled={message.trim().length < 2 || submitting}
              onClick={() => void submitFeedback()}
              type="button"
            >
              {submitting ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
              {submitting ? "正在发送" : "发送反馈"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
