"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  XIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  viewerLightboxOnboardingStorageKey,
  viewerOnboardingStorageKey,
  viewerServiceNoticeDismissedEvent,
  viewerServiceNoticeStorageKey,
} from "@/lib/viewer-onboarding";

interface ViewerOnboardingProps {
  readonly attributeFilterEnabled: boolean;
  readonly bibSearchEnabled: boolean;
  readonly faceSearchEnabled: boolean;
  readonly hasPhotos: boolean;
  readonly live: boolean;
  readonly searchAvailable: boolean;
}

type MainTarget = "filters" | "gallery" | "search";
type TargetKind = MainTarget | "lightbox-toolbar";

interface MainStep {
  readonly description: string;
  readonly target: MainTarget;
  readonly title: string;
}

type FlowState =
  | { readonly kind: "main"; readonly step: number }
  | { readonly kind: "lightbox"; readonly step: number }
  | null;

interface SpotlightRect {
  readonly bottom: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
  readonly width: number;
}

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
    // The current page still behaves correctly when storage is unavailable.
  }
}

function joinChinese(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "找照片";
  if (items.length === 2) return `${items[0]}或${items[1]}`;
  return `${items.slice(0, -1).join("、")}或${items.at(-1)}`;
}

function resolveTarget(kind: TargetKind): HTMLElement | null {
  if (kind === "filters") {
    return document.querySelector<HTMLElement>('nav[aria-label="相册筛选"]');
  }

  if (kind === "search") {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("#gallery-main button"));
    return (
      buttons.find((button) => {
        const label = button.textContent?.replace(/\s+/gu, "").trim() ?? "";
        return label.startsWith("找照片") && button.querySelector("svg") !== null;
      }) ?? null
    );
  }

  if (kind === "gallery") {
    const gallery = document.querySelector<HTMLElement>('section[aria-label="活动照片网格"]');
    return gallery?.querySelector<HTMLElement>("[data-media-id]") ?? gallery;
  }

  const controls = Array.from(
    document.querySelectorAll<HTMLElement>("[data-lightbox-controls]"),
  );
  return controls.at(-1) ?? null;
}

function readLightboxActions(): string[] {
  const toolbar = resolveTarget("lightbox-toolbar");
  if (toolbar === null) return [];
  const actions: string[] = [];
  if (toolbar.querySelector('button[aria-label="点赞"], button[aria-label="取消点赞"]')) {
    actions.push("点赞");
  }
  const text = toolbar.textContent ?? "";
  if (text.includes("分享")) actions.push("分享");
  if (text.includes("下载")) actions.push("保存或下载");
  return actions;
}

export function ViewerOnboarding({
  attributeFilterEnabled,
  bibSearchEnabled,
  faceSearchEnabled,
  hasPhotos,
  live,
  searchAvailable,
}: ViewerOnboardingProps) {
  const [mounted, setMounted] = useState(false);
  const [flow, setFlow] = useState<FlowState>(null);
  const [hasSeenMain, setHasSeenMain] = useState(false);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const [lightboxActions, setLightboxActions] = useState<readonly string[]>([]);
  const cardRef = useRef<HTMLElement>(null);

  const searchMethods = useMemo(() => {
    const methods: string[] = [];
    if (faceSearchEnabled) methods.push("人脸");
    if (bibSearchEnabled) methods.push("号码");
    if (bibSearchEnabled && attributeFilterEnabled) methods.push("年级班级");
    return methods;
  }, [attributeFilterEnabled, bibSearchEnabled, faceSearchEnabled]);

  const mainSteps = useMemo<readonly MainStep[]>(() => {
    const steps: MainStep[] = [
      {
        target: "filters",
        title: "按分类浏览照片",
        description: "你可以查看全部照片、精选照片，或按不同分类快速浏览。",
      },
    ];

    if (searchAvailable) {
      steps.push({
        target: "search",
        title: "快速找到你的照片",
        description:
          searchMethods.length === 0
            ? "照片很多时，可以使用找照片功能快速筛选。"
            : `照片很多时，可以通过${joinChinese(searchMethods)}快速筛选。`,
      });
    }

    steps.push({
      target: "gallery",
      title: hasPhotos ? "浏览活动照片" : "照片会显示在这里",
      description: hasPhotos
        ? live
          ? "点击任意照片即可进入大图查看；活动进行期间，新照片还会持续更新。"
          : "点击任意照片即可进入大图查看。"
        : live
          ? "活动照片发布后会持续出现在这里，你可以直接点击照片进入大图查看。"
          : "活动照片发布后会显示在这里，你可以直接点击照片进入大图查看。",
    });

    return steps;
  }, [hasPhotos, live, searchAvailable, searchMethods]);

  const beginMain = useCallback(() => {
    setSpotlightRect(null);
    setFlow({ kind: "main", step: -1 });
  }, []);

  useEffect(() => {
    setMounted(true);
    const mainSeen = storageSeen(viewerOnboardingStorageKey);
    setHasSeenMain(mainSeen);
    if (mainSeen) return;

    if (storageSeen(viewerServiceNoticeStorageKey)) {
      beginMain();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const afterNotice = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(beginMain, 120);
    };
    window.addEventListener(viewerServiceNoticeDismissedEvent, afterNotice, { once: true });
    return () => {
      window.removeEventListener(viewerServiceNoticeDismissedEvent, afterNotice);
      if (timer !== null) clearTimeout(timer);
    };
  }, [beginMain]);

  useEffect(() => {
    if (!mounted || flow !== null || !hasSeenMain) return;
    if (storageSeen(viewerLightboxOnboardingStorageKey)) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const maybeOpen = () => {
      if (resolveTarget("lightbox-toolbar") === null) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        const toolbar = resolveTarget("lightbox-toolbar");
        if (toolbar === null) return;
        setLightboxActions(readLightboxActions());
        setFlow({ kind: "lightbox", step: 0 });
      }, 180);
    };

    maybeOpen();
    const observer = new MutationObserver(maybeOpen);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [flow, hasSeenMain, mounted]);

  const targetKind: TargetKind | null = useMemo(() => {
    if (flow?.kind === "main" && flow.step >= 0) {
      return mainSteps[flow.step]?.target ?? null;
    }
    if (flow?.kind === "lightbox" && flow.step === 0) return "lightbox-toolbar";
    return null;
  }, [flow, mainSteps]);

  useEffect(() => {
    if (flow === null || targetKind === null) {
      setSpotlightRect(null);
      return;
    }

    const target = resolveTarget(targetKind);
    if (target === null) {
      setSpotlightRect(null);
      return;
    }

    if (targetKind !== "lightbox-toolbar") {
      const bounds = target.getBoundingClientRect();
      const obscuredTop = bounds.top < 120;
      const obscuredBottom = bounds.bottom > window.innerHeight - 120;
      if (obscuredTop || obscuredBottom) {
        target.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "center",
        });
      }
    }

    const measure = () => {
      const current = resolveTarget(targetKind);
      if (current === null) {
        setSpotlightRect(null);
        return;
      }
      const bounds = current.getBoundingClientRect();
      const padding = targetKind === "gallery" ? 5 : 8;
      const left = Math.max(8, bounds.left - padding);
      const top = Math.max(8, bounds.top - padding);
      const right = Math.min(window.innerWidth - 8, bounds.right + padding);
      const bottom = Math.min(window.innerHeight - 8, bounds.bottom + padding);
      setSpotlightRect({
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
    };

    measure();
    const animationTimer = setTimeout(measure, 320);
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(target);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(animationTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [flow, targetKind]);

  useEffect(() => {
    if (flow === null) return;
    const timer = requestAnimationFrame(() => cardRef.current?.focus());
    return () => cancelAnimationFrame(timer);
  }, [flow]);

  useEffect(() => {
    if (flow === null) return;
    const intercept = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", intercept, true);
    return () => document.removeEventListener("keydown", intercept, true);
  }, [flow]);

  const finishMain = useCallback(() => {
    markStorageSeen(viewerOnboardingStorageKey);
    setHasSeenMain(true);
    setSpotlightRect(null);
    setFlow(null);
  }, []);

  const finishLightbox = useCallback(() => {
    markStorageSeen(viewerLightboxOnboardingStorageKey);
    setSpotlightRect(null);
    setFlow(null);
  }, []);

  const next = useCallback(() => {
    setFlow((current) => {
      if (current === null) return current;
      if (current.kind === "main") {
        if (current.step < 0) return { kind: "main", step: 0 };
        if (current.step >= mainSteps.length - 1) {
          queueMicrotask(finishMain);
          return current;
        }
        return { kind: "main", step: current.step + 1 };
      }
      if (current.step >= 1) {
        queueMicrotask(finishLightbox);
        return current;
      }
      return { kind: "lightbox", step: current.step + 1 };
    });
  }, [finishLightbox, finishMain, mainSteps.length]);

  const previous = useCallback(() => {
    setFlow((current) => {
      if (current === null) return current;
      if (current.kind === "main") {
        return { kind: "main", step: Math.max(-1, current.step - 1) };
      }
      return { kind: "lightbox", step: Math.max(0, current.step - 1) };
    });
  }, []);

  const replayMain = useCallback(() => {
    setSpotlightRect(null);
    setFlow({ kind: "main", step: -1 });
  }, []);

  const cardPosition = useMemo<CSSProperties>(() => {
    if (spotlightRect === null || spotlightRect.viewportWidth < 640) {
      return {
        left: "1rem",
        right: "1rem",
        bottom: "max(3.25rem, calc(2.5rem + env(safe-area-inset-bottom)))",
      };
    }

    const cardHalfWidth = 208;
    const center = Math.min(
      spotlightRect.viewportWidth - cardHalfWidth - 16,
      Math.max(cardHalfWidth + 16, spotlightRect.left + spotlightRect.width / 2),
    );
    const horizontal: CSSProperties = {
      left: center,
      transform: "translateX(-50%)",
      width: "min(26rem, calc(100vw - 2rem))",
    };

    if (spotlightRect.top > spotlightRect.viewportHeight * 0.54) {
      return {
        ...horizontal,
        bottom: spotlightRect.viewportHeight - spotlightRect.top + 16,
      };
    }

    return { ...horizontal, top: spotlightRect.bottom + 16 };
  }, [spotlightRect]);

  const currentMainStep =
    flow?.kind === "main" && flow.step >= 0 ? (mainSteps[flow.step] ?? null) : null;
  const welcome = flow?.kind === "main" && flow.step < 0;
  const lightboxToolbar = flow?.kind === "lightbox" && flow.step === 0;
  const lightboxNavigation = flow?.kind === "lightbox" && flow.step === 1;

  const overlay =
    !mounted || flow === null ? null : (
      <div
        aria-label="使用引导"
        className="fixed inset-0 z-[80]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (flow.kind === "main") finishMain();
            else finishLightbox();
          }
        }}
        role="presentation"
      >
        {spotlightRect === null ? (
          <div className="absolute inset-0 bg-black/58 backdrop-blur-[1px]" />
        ) : (
          <svg
            aria-hidden="true"
            className="absolute inset-0 size-full"
            preserveAspectRatio="none"
          >
            <defs>
              <mask id="viewer-onboarding-mask">
                <rect fill="white" height="100%" width="100%" x="0" y="0" />
                <rect
                  fill="black"
                  height={spotlightRect.height}
                  rx="14"
                  width={spotlightRect.width}
                  x={spotlightRect.left}
                  y={spotlightRect.top}
                />
              </mask>
            </defs>
            <rect
              fill="rgb(0 0 0 / 0.58)"
              height="100%"
              mask="url(#viewer-onboarding-mask)"
              width="100%"
              x="0"
              y="0"
            />
            <rect
              fill="none"
              height={spotlightRect.height}
              rx="14"
              stroke="rgb(255 255 255 / 0.9)"
              strokeWidth="2"
              width={spotlightRect.width}
              x={spotlightRect.left}
              y={spotlightRect.top}
            />
          </svg>
        )}

        <section
          aria-describedby="viewer-onboarding-description"
          aria-labelledby="viewer-onboarding-title"
          aria-modal="true"
          className="public-theme fixed z-[82] rounded-2xl border bg-background/98 p-4 text-foreground shadow-2xl shadow-black/30 backdrop-blur-xl outline-none sm:p-5"
          ref={cardRef}
          role="dialog"
          style={cardPosition}
          tabIndex={-1}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {welcome ? (
                <p className="mb-1 text-xs font-medium text-primary">首次使用引导</p>
              ) : null}
              {currentMainStep !== null ? (
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {flow.kind === "main" ? `${flow.step + 1} / ${mainSteps.length}` : null}
                </p>
              ) : null}
              {flow.kind === "lightbox" ? (
                <p className="mb-1 text-xs font-medium text-white/65">
                  大图查看 · {flow.step + 1} / 2
                </p>
              ) : null}
              <h2 className="text-base font-semibold leading-6" id="viewer-onboarding-title">
                {welcome
                  ? "欢迎使用北航实验学校中学部照片实时直播系统"
                  : currentMainStep?.title ??
                    (lightboxToolbar ? "更多照片操作" : "继续浏览照片")}
              </h2>
            </div>

            <Button
              aria-label="跳过使用引导"
              className="-mt-1 -mr-1 shrink-0"
              onClick={flow.kind === "main" ? finishMain : finishLightbox}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>

          <p
            className="mt-2 text-sm leading-6 text-muted-foreground"
            id="viewer-onboarding-description"
          >
            {welcome
              ? "活动照片将持续更新，你可以实时浏览，也可以快速找到自己的照片。"
              : currentMainStep?.description ??
                (lightboxToolbar
                  ? lightboxActions.length > 0
                    ? `这里可以${joinChinese(lightboxActions)}这张照片。`
                    : "这里可以对当前照片进行点赞、分享或保存等操作。"
                  : "手机上左右滑动即可切换照片；电脑上也可以使用左右方向键或两侧按钮快速切换。")}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              className={welcome ? "invisible" : undefined}
              disabled={welcome}
              onClick={previous}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ChevronLeftIcon data-icon="inline-start" />
              上一步
            </Button>

            <div className="flex items-center gap-2">
              <Button
                onClick={flow.kind === "main" ? finishMain : finishLightbox}
                size="sm"
                type="button"
                variant="ghost"
              >
                跳过
              </Button>
              <Button onClick={next} size="sm" type="button">
                {welcome
                  ? "开始了解"
                  : flow.kind === "main" && flow.step >= mainSteps.length - 1
                    ? "开始浏览"
                    : lightboxNavigation
                      ? "知道了"
                      : "下一步"}
                {welcome || currentMainStep !== null || lightboxToolbar ? (
                  <ChevronRightIcon data-icon="inline-end" />
                ) : null}
              </Button>
            </div>
          </div>
        </section>
      </div>
    );

  return (
    <>
      {mounted && flow === null && hasSeenMain ? (
        <Button
          aria-label="重新查看使用引导"
          className="fixed right-2.5 bottom-[calc(2.5rem+env(safe-area-inset-bottom))] z-30 h-8 rounded-full bg-background/82 px-2.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-md hover:text-foreground sm:right-4 sm:px-3"
          onClick={replayMain}
          size="sm"
          type="button"
          variant="outline"
        >
          <CircleHelpIcon className="size-3.5" />
          <span className="hidden sm:inline">使用帮助</span>
        </Button>
      ) : null}
      {overlay === null ? null : createPortal(overlay, document.body)}
    </>
  );
}
