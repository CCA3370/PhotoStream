"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const weChatSaveHintToastId = "photostream-wechat-save-hint";
const weChatLongPressDurationMs = 650;
const weChatLongPressMoveTolerancePx = 12;

interface PhotoStreamToastData {
  readonly presentation?: "wechat-save-hint";
}

function isWeChatSaveHintTitle(title: ReactNode): boolean {
  return (
    title === "原图已加载完成，请长按图片并选择“保存到手机”" ||
    title === "普通图已加载完成，请长按图片并选择“保存到手机”"
  );
}

const toast = ToastPrimitive.createToastManager();
const baseToastAdd = toast.add.bind(toast);
type ToastAddOptions = Parameters<typeof toast.add>[0];

toast.add = ((options: ToastAddOptions) => {
  if (!isWeChatSaveHintTitle(options.title)) return baseToastAdd(options);

  return baseToastAdd({
    ...options,
    id: weChatSaveHintToastId,
    title: "长按图片保存",
    description: "按住图片，圆环闭合后选择「保存到手机」",
    type: "info",
    priority: "high",
    timeout: 0,
    data: {
      ...(typeof options.data === "object" && options.data !== null ? options.data : {}),
      presentation: "wechat-save-hint",
    },
  });
}) as typeof toast.add;

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed inset-x-4 bottom-4 z-[100] mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full",
        className,
      )}
      {...props}
    />
  );
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom rounded-2xl border bg-popover text-popover-foreground shadow-lg will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:[transform:translateY(150%)]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]",
        "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      render={render}
      aria-label="关闭通知"
      className={cn(
        "relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: ReactNode = null;

  if (type === "success") {
    icon = <CircleCheckIcon aria-hidden="true" />;
  }

  if (type === "info") {
    icon = <InfoIcon aria-hidden="true" />;
  }

  if (type === "warning") {
    icon = <TriangleAlertIcon aria-hidden="true" />;
  }

  if (type === "error") {
    icon = <OctagonXIcon className="text-destructive" aria-hidden="true" />;
  }

  if (type === "loading") {
    icon = <Loader2Icon className="animate-spin" aria-hidden="true" />;
  }

  if (!icon) {
    return null;
  }

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  );
}

function WeChatSaveHintToast({
  toastItem,
}: {
  toastItem: ToastPrimitive.Root.Props["toast"];
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - holdProgress);

  useEffect(() => {
    let activePointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let animationFrame: number | null = null;
    let dismissTimer: number | null = null;

    const clearAnimation = () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    };

    const resetHold = () => {
      clearAnimation();
      activePointerId = null;
      setHoldProgress(0);
    };

    const isPhotoTarget = (target: EventTarget | null) =>
      target instanceof Element && target.closest("img") !== null;

    const dismiss = () => {
      clearAnimation();
      activePointerId = null;
      setHoldProgress(1);
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => closeButtonRef.current?.click(), 80);
    };

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / weChatLongPressDurationMs);
      setHoldProgress(progress);
      if (progress >= 1) {
        dismiss();
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isPhotoTarget(event.target)) return;
      resetHold();
      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startedAt = performance.now();
      animationFrame = window.requestAnimationFrame(tick);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      if (
        Math.hypot(event.clientX - startX, event.clientY - startY) >
        weChatLongPressMoveTolerancePx
      ) {
        resetHold();
      }
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === activePointerId) resetHold();
    };

    const onContextMenu = (event: MouseEvent) => {
      if (isPhotoTarget(event.target)) dismiss();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
    document.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      clearAnimation();
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerEnd, true);
      document.removeEventListener("pointercancel", onPointerEnd, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);

  return (
    <ToastPrimitive.Root
      aria-live="polite"
      className="dark public-theme pointer-events-none fixed inset-0 z-[200] grid place-items-center px-4 text-white opacity-100 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
      toast={toastItem}
    >
      <div className="flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-white/10 bg-black/80 px-4 py-3 text-left shadow-xl shadow-black/30 backdrop-blur-md">
        <div className="relative grid size-11 shrink-0 place-items-center" aria-hidden="true">
          <svg className="absolute inset-0 size-11 -rotate-90" viewBox="0 0 40 40">
            <circle
              className="text-white/15"
              cx="20"
              cy="20"
              fill="none"
              r={radius}
              stroke="currentColor"
              strokeWidth="3"
            />
            <circle
              className="text-white"
              cx="20"
              cy="20"
              fill="none"
              r={radius}
              stroke="currentColor"
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
              strokeLinecap="round"
              strokeWidth="3"
              style={{
                transition:
                  holdProgress === 0 ? "stroke-dashoffset 180ms ease-out" : "none",
              }}
            />
          </svg>
          <span className="text-[9px] font-medium text-white/80">按住</span>
        </div>
        <div className="min-w-0">
          <ToastPrimitive.Title className="text-sm font-medium" />
          <ToastPrimitive.Description className="mt-0.5 text-xs leading-5 text-white/70" />
        </div>
      </div>
      <ToastPrimitive.Close
        aria-hidden="true"
        className="sr-only"
        ref={closeButtonRef}
        tabIndex={-1}
      >
        关闭
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

function isWeChatSaveHintToast(toastItem: ToastPrimitive.Root.Props["toast"]): boolean {
  const data = toastItem.data as PhotoStreamToastData | undefined;
  return data?.presentation === "wechat-save-hint";
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((toastItem) => {
    if (isWeChatSaveHintToast(toastItem)) {
      return <WeChatSaveHintToast key={toastItem.id} toastItem={toastItem} />;
    }
    return (
      <Toast key={toastItem.id} toast={toastItem}>
        <ToastContent>
          <ToastIcon type={toastItem.type} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ToastTitle />
            <ToastDescription />
          </div>
          <ToastAction />
          <ToastClose />
        </ToastContent>
      </Toast>
    );
  });
}

function Toaster({ children, toastManager = toast, ...props }: ToastPrimitive.Provider.Props) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export {
  createToastManager,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  Toaster,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  toast,
  useToastManager,
};