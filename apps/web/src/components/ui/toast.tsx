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
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const weChatSaveHintStorageKey = "photostream.wechat-save-hint.dismissed.v1";
const weChatSaveHintToastId = "photostream-wechat-save-hint";

interface PhotoStreamToastData {
  readonly presentation?: "wechat-save-hint";
}

function isWeChatSaveHintTitle(title: ReactNode): boolean {
  return (
    title === "原图已加载完成，请长按图片并选择“保存到手机”" ||
    title === "普通图已加载完成，请长按图片并选择“保存到手机”"
  );
}

function isWeChatSaveHintSuppressed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(weChatSaveHintStorageKey) === "1";
  } catch {
    return false;
  }
}

function suppressWeChatSaveHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(weChatSaveHintStorageKey, "1");
  } catch {
    // Keep the confirmation usable even when storage is unavailable.
  }
}

const toast = ToastPrimitive.createToastManager();
const baseToastAdd = toast.add.bind(toast);
type ToastAddOptions = Parameters<typeof toast.add>[0];

toast.add = ((options: ToastAddOptions) => {
  if (!isWeChatSaveHintTitle(options.title)) return baseToastAdd(options);
  if (isWeChatSaveHintSuppressed()) return options.id ?? weChatSaveHintToastId;

  return baseToastAdd({
    ...options,
    id: options.id ?? weChatSaveHintToastId,
    title: "还差一步",
    description:
      "图片已准备好，但还没有保存到手机。点击「我知道了」后，长按图片并选择「保存到手机」。",
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
      aria-label="关闭通知"
      render={render}
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

function WeChatSaveHintToast({ toastItem }: { toastItem: ToastPrimitive.Root.Props["toast"] }) {
  const [dontRemindAgain, setDontRemindAgain] = useState(false);

  useEffect(() => {
    setDontRemindAgain(false);
  }, [toastItem.updateKey]);

  return (
    <ToastPrimitive.Root
      aria-describedby="wechat-save-hint-description"
      aria-labelledby="wechat-save-hint-title"
      aria-modal="true"
      className="dark public-theme pointer-events-auto fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 py-6 text-white opacity-100 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
      role="dialog"
      toast={toastItem}
    >
      <div className="w-full max-w-sm rounded-3xl border border-white/12 bg-zinc-950/95 p-5 shadow-2xl shadow-black/50 sm:p-6">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-sky-400/15 text-sky-300">
          <InfoIcon aria-hidden="true" className="size-7" />
        </div>
        <ToastPrimitive.Title
          className="text-center text-xl font-semibold tracking-tight"
          id="wechat-save-hint-title"
        />
        <ToastPrimitive.Description
          className="mt-2 text-center text-[15px] leading-6 text-white/72"
          id="wechat-save-hint-description"
        />

        <label
          className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/[0.08]"
          htmlFor="wechat-save-hint-dont-remind"
        >
          <Checkbox
            checked={dontRemindAgain}
            className="size-5 rounded-md border-2 border-white/30 bg-white/[0.06] data-checked:border-primary data-checked:bg-primary"
            id="wechat-save-hint-dont-remind"
            onCheckedChange={setDontRemindAgain}
          />
          <span>下次不再提醒</span>
        </label>

        <ToastPrimitive.Close
          onClick={() => {
            if (dontRemindAgain) suppressWeChatSaveHint();
          }}
          render={
            <Button
              autoFocus
              className="mt-4 h-11 w-full rounded-xl text-base font-medium"
              type="button"
            />
          }
        >
          我知道了
        </ToastPrimitive.Close>
      </div>
    </ToastPrimitive.Root>
  );
}

function isWeChatSaveHintToast(toastItem: ToastPrimitive.Root.Props["toast"]): boolean {
  const data = toastItem.data as PhotoStreamToastData | undefined;
  return data?.presentation === "wechat-save-hint";
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((toastItem) =>
    isWeChatSaveHintToast(toastItem) ? (
      <WeChatSaveHintToast key={toastItem.id} toastItem={toastItem} />
    ) : (
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
    ),
  );
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
