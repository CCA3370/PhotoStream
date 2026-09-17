"use client";

import { ChevronLeftIcon, ChevronRightIcon, CircleHelpIcon, XIcon } from "lucide-react";
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

type MainTarget = "filters" | "help" | "search";
type TargetKind = MainTarget | "lightbox-navigation" | "lightbox-toolbar";

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

function elementVisible(element: HTMLElement): boolean {
  if (element.getAttribute("aria-hidden") === "true") return false;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

function lightboxOpen(): boolean {
  return document.querySelector<HTMLElement>('[aria-label="照片画布"]') !== null;
}

function lightboxActionButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("button")).filter((button) => {
    if (!elementVisible(button)) return false;
    const label = button.getAttribute("aria-label") ?? "";
    const text = button.textContent ?? "";
    return (
      label === "点赞" ||
      label === "取消点赞" ||
      label.includes("分享") ||
      label.includes("下载") ||
      text.includes("分享") ||
      text.includes("下载")
    );
  });
}

function resolveTarget(kind: TargetKind): HTMLElement | null {
  if (kind === "filters") {
    return document.querySelector<HTMLElement>('nav[aria-label="相册筛选"]');
  }

  if (kind === "search") {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#gallery-main button"),
    );
    return (
      buttons.find((button) => (button.textContent ?? "").includes("找照片")) ??
      buttons.find((button) => button.querySelector("svg.lucide-search") !== null) ??
      null
    );
  }

  if (kind === "help") {
    return document.querySelector<HTMLElement>("[data-viewer-help-trigger]");
  }

  if (kind === "lightbox-navigation") {
    const next = document.querySelector<HTMLElement>('button[aria-label="下一张照片"]');
    if (next !== null && elementVisible(next)) return next;
    return document.querySelector<HTMLElement>('[aria-label="照片画布"]');
  }

  const controls = Array.from(document.querySelectorAll<HTMLElement>("[data-lightbox-controls]"));
  const visibleControls = controls.filter(elementVisible);
  return (
    visibleControls.find((control) => lightboxActionButtons(control).length > 0) ??
    visibleControls.at(-1) ??
    null
  );
}

function unionBounds(elements: readonly HTMLElement[]): DOMRect | null {
  const bounds = elements.map((element) => element.getBoundingClientRect());
  if (bounds.length === 0) return null;
  const left = Math.min(...bounds.map((item) => item.left));
  const top = Math.min(...bounds.map((item) => item.top));
  const right = Math.max(...bounds.map((item) => item.right));
  const bottom = Math.max(...bounds.map((item) => item.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function targetBounds(kind: TargetKind, target: HTMLElement): DOMRect {
  if (kind === "lightbox-toolbar") {
    const actionBounds = unionBounds(lightboxActionButtons(target));
    if (actionBounds !== null) return actionBounds;
  }

  if (kind === "lightbox-navigation" && target.matches('[aria-label="照片画布"]')) {
    const bounds = target.getBoundingClientRect();
    const width = Math.min(bounds.width * 0.7, 420);
    const height = Math.min(bounds.height * 0.36, 280);
    return new DOMRect(
      bounds.left + (bounds.width - width) / 2,
      bounds.top + (bounds.height - height) / 2,
      width,
      height,
    );
  }

  return target.getBoundingClientRect();
}

function readLightboxActions(): string[] {
  const toolbar = resolveTarget("lightbox-toolbar");
  if (toolbar === null) return [];
  const actions: string[] = [];
  const buttons = lightboxActionButtons(toolbar);
  if (
    buttons.some((button) => {
      const label = button.getAttribute("aria-label");
      return label === "点赞" || label === "取消点赞";
    })
  ) {
    actions.push("点赞");
  }
  const text = buttons.map((button) => button.textContent ?? "").join(" ");
  if (text.includes("分享")) actions.push("分享");
  if (text.includes("下载")) actions.push("下载");
  return actions;
}

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (container === null) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function arrowPath(card: DOMRect, spotlight: SpotlightRect): string {
  const targetX = spotlight.left + spotlight.width / 2;
  const targetY = spotlight.top + spotlight.height / 2;
  let startX = clamp(targetX, card.left + 28, card.right - 28);
  let startY = card.bottom;
  let endX = targetX;
  let endY = spotlight.top - 7;

  if (card.top >= spotlight.bottom) {
    startY = card.top;
    endY = spotlight.bottom + 7;
  } else if (card.right <= spotlight.left) {
    startX = card.right;
    startY = clamp(targetY, card.top + 24, card.bottom - 24);
    endX = spotlight.left - 7;
    endY = targetY;
  } else if (card.left >= spotlight.right) {
    startX = card.left;
    startY = clamp(targetY, card.top + 24, card.bottom - 24);
    endX = spotlight.right + 7;
    endY = targetY;
  }

  const dx = endX - startX;
  const dy = endY - startY;
  const control1X = startX + dx * 0.18;
  const control1Y = startY + dy * 0.42;
  const control2X = startX + dx * 0.82;
  const control2Y = startY + dy * 0.58;
  return `M ${startX} ${startY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${endX} ${endY}`;
}

export function ViewerOnboarding({
  attributeFilterEnabled,
  bibSearchEnabled,
  faceSearchEnabled,
  searchAvailable,
}: ViewerOnboardingProps) {
  const [mounted, setMounted] = useState(false);
  const [flow, setFlow] = useState<FlowState>(null);
  const [hasSeenMain, setHasSeenMain] = useState(false);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const [lightboxActions, setLightboxActions] = useState<readonly string[]>([]);
  const [pointerPath, setPointerPath] = useState<string | null>(null);
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
      target: "help",
      title: "帮助与反馈",
      description:
        "点击右下角问号，可以随时重新查看使用引导，也可以提交遇到的问题或建议。我们会尽快查看并处理你的反馈，部分问题最快可在约 10 分钟内完成调整。",
    });

    return steps;
  }, [searchAvailable, searchMethods]);

  const beginMain = useCallback(() => {
    setSpotlightRect(null);
    setPointerPath(null);
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

    const schedule = () => {
      if (!lightboxOpen()) {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        return;
      }
      if (timer !== null) return;

      timer = setTimeout(() => {
        timer = null;
        if (!lightboxOpen() || resolveTarget("lightbox-toolbar") === null) return;
        setLightboxActions(readLightboxActions());
        setFlow({ kind: "lightbox", step: 0 });
      }, 180);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [flow, hasSeenMain, mounted]);

  useEffect(() => {
    if (flow?.kind !== "lightbox") return;

    const closeIfViewerClosed = () => {
      if (lightboxOpen()) return;
      setSpotlightRect(null);
      setPointerPath(null);
      setFlow(null);
    };

    closeIfViewerClosed();
    const observer = new MutationObserver(closeIfViewerClosed);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [flow?.kind]);

  const targetKind: TargetKind | null = useMemo(() => {
    if (flow?.kind === "main" && flow.step >= 0) {
      return mainSteps[flow.step]?.target ?? null;
    }
    if (flow?.kind === "lightbox" && flow.step === 0) return "lightbox-toolbar";
    if (flow?.kind === "lightbox" && flow.step === 1) return "lightbox-navigation";
    return null;
  }, [flow, mainSteps]);

  useEffect(() => {
    if (flow === null || targetKind === null) {
      setSpotlightRect(null);
      setPointerPath(null);
      return;
    }

    const target = resolveTarget(targetKind);
    if (target === null) {
      setSpotlightRect(null);
      setPointerPath(null);
      return;
    }

    if (targetKind === "filters" || targetKind === "search") {
      const bounds = targetBounds(targetKind, target);
      const obscuredTop = bounds.top < 124;
      const obscuredBottom = bounds.bottom > window.innerHeight - 160;
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
        setPointerPath(null);
        return;
      }
      const bounds = targetBounds(targetKind, current);
      const padding = targetKind.startsWith("lightbox") ? 10 : 8;
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

  const cardPosition = useMemo<CSSProperties>(() => {
    if (spotlightRect === null) {
      return {
        left: "1rem",
        right: "1rem",
        bottom: "max(3.25rem, calc(2.5rem + env(safe-area-inset-bottom)))",
      };
    }

    if (spotlightRect.viewportWidth < 640) {
      const spaceAbove = spotlightRect.top;
      const spaceBelow = spotlightRect.viewportHeight - spotlightRect.bottom;
      if (spaceAbove > spaceBelow && spaceAbove > 230) {
        return {
          left: "1rem",
          right: "1rem",
          bottom: spotlightRect.viewportHeight - spotlightRect.top + 18,
        };
      }
      return {
        left: "1rem",
        right: "1rem",
        top: spotlightRect.bottom + 18,
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
        bottom: spotlightRect.viewportHeight - spotlightRect.top + 20,
      };
    }

    return { ...horizontal, top: spotlightRect.bottom + 20 };
  }, [spotlightRect]);

  useEffect(() => {
    if (flow === null || spotlightRect === null || cardRef.current === null) {
      setPointerPath(null);
      return;
    }

    const update = () => {
      const card = cardRef.current;
      if (card === null) {
        setPointerPath(null);
        return;
      }
      setPointerPath(arrowPath(card.getBoundingClientRect(), spotlightRect));
    };

    const frame = requestAnimationFrame(update);
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(cardRef.current);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [flow, spotlightRect]);

  useEffect(() => {
    if (flow === null) return;
    const timer = requestAnimationFrame(() => cardRef.current?.focus());
    return () => cancelAnimationFrame(timer);
  }, [flow]);

  const finishMain = useCallback(() => {
    markStorageSeen(viewerOnboardingStorageKey);
    setHasSeenMain(true);
    setSpotlightRect(null);
    setPointerPath(null);
    setFlow(null);
  }, []);

  const finishLightbox = useCallback(() => {
    markStorageSeen(viewerLightboxOnboardingStorageKey);
    setSpotlightRect(null);
    setPointerPath(null);
    setFlow(null);
  }, []);

  useEffect(() => {
    if (flow === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.stopImmediatePropagation();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (flow.kind === "main") finishMain();
        else finishLightbox();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = focusableElements(cardRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        cardRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === cardRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [finishLightbox, finishMain, flow]);

  const next = useCallback(() => {
    if (flow === null) return;
    if (flow.kind === "main") {
      if (flow.step < 0) {
        setFlow({ kind: "main", step: 0 });
        return;
      }
      if (flow.step >= mainSteps.length - 1) {
        finishMain();
        return;
      }
      setFlow({ kind: "main", step: flow.step + 1 });
      return;
    }

    if (flow.step >= 1) {
      finishLightbox();
      return;
    }
    setFlow({ kind: "lightbox", step: flow.step + 1 });
  }, [finishLightbox, finishMain, flow, mainSteps.length]);

  const previous = useCallback(() => {
    if (flow === null) return;
    if (flow.kind === "main") {
      setFlow({ kind: "main", step: Math.max(-1, flow.step - 1) });
      return;
    }
    setFlow({ kind: "lightbox", step: Math.max(0, flow.step - 1) });
  }, [flow]);

  const replayMain = useCallback(() => {
    setSpotlightRect(null);
    setPointerPath(null);
    setFlow({ kind: "main", step: -1 });
  }, []);

  const currentMainStep =
    flow?.kind === "main" && flow.step >= 0 ? (mainSteps[flow.step] ?? null) : null;
  const welcome = flow?.kind === "main" && flow.step < 0;
  const lightboxToolbar = flow?.kind === "lightbox" && flow.step === 0;
  const lightboxNavigation = flow?.kind === "lightbox" && flow.step === 1;

  const overlay =
    !mounted || flow === null ? null : (
      <div className="fixed inset-0 z-[80] overflow-hidden">
        {spotlightRect === null ? (
          <div className="pointer-events-none absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
        ) : (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-[18px] border-2 border-white/95 transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none"
              style={{
                left: spotlightRect.left,
                top: spotlightRect.top,
                width: spotlightRect.width,
                height: spotlightRect.height,
                boxShadow:
                  "0 0 0 9999px rgb(0 0 0 / 0.64), 0 0 0 5px rgb(255 255 255 / 0.10), 0 0 34px rgb(255 255 255 / 0.28)",
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-[22px] border border-primary/90 opacity-90 animate-pulse motion-reduce:animate-none"
              style={{
                left: spotlightRect.left - 4,
                top: spotlightRect.top - 4,
                width: spotlightRect.width + 8,
                height: spotlightRect.height + 8,
              }}
            />
          </>
        )}

        {pointerPath === null ? null : (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[81] size-full"
            preserveAspectRatio="none"
          >
            <defs>
              <marker
                id="viewer-onboarding-arrowhead"
                markerHeight="7"
                markerWidth="7"
                orient="auto"
                refX="5.5"
                refY="3.5"
              >
                <path d="M 0 0 L 7 3.5 L 0 7 z" fill="rgb(255 255 255 / 0.96)" />
              </marker>
              <filter
                id="viewer-onboarding-arrow-shadow"
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feDropShadow
                  dx="0"
                  dy="1"
                  floodColor="black"
                  floodOpacity="0.45"
                  stdDeviation="2"
                />
              </filter>
            </defs>
            <path
              d={pointerPath}
              fill="none"
              filter="url(#viewer-onboarding-arrow-shadow)"
              markerEnd="url(#viewer-onboarding-arrowhead)"
              stroke="rgb(255 255 255 / 0.96)"
              strokeLinecap="round"
              strokeWidth="2.5"
            />
          </svg>
        )}

        <section
          aria-describedby="viewer-onboarding-description"
          aria-labelledby="viewer-onboarding-title"
          aria-modal="true"
          className="public-theme fixed z-[82] rounded-2xl border border-border/80 bg-background/98 p-4 text-foreground shadow-2xl shadow-black/35 backdrop-blur-xl outline-none sm:p-5"
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
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  大图查看 · {flow.step + 1} / 2
                </p>
              ) : null}
              <h2 className="text-base font-semibold leading-6" id="viewer-onboarding-title">
                {welcome
                  ? "欢迎使用北航实验学校中学部照片实时直播系统"
                  : (currentMainStep?.title ??
                    (lightboxToolbar ? "更多照片操作" : "继续浏览照片"))}
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
              : (currentMainStep?.description ??
                (lightboxToolbar
                  ? lightboxActions.length > 0
                    ? `这里可以${joinChinese(lightboxActions)}这张照片。`
                    : "这里可以对当前照片进行点赞、分享或下载等操作。"
                  : "手机上左右滑动即可切换照片；电脑上也可以使用左右方向键或两侧按钮快速切换。"))}
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
