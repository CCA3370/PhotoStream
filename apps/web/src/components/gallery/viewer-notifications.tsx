"use client";

import type {
  AlbumNotificationView,
  PublicAlbumNotificationState,
} from "@photostream/contracts";
import { BellIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clientGet } from "@/lib/client-api";
import {
  viewerOnboardingDismissedEvent,
  viewerOnboardingStorageKey,
  viewerServiceNoticeDismissedEvent,
  viewerServiceNoticeStorageKey,
} from "@/lib/viewer-onboarding";

const notificationUpdatedEvent = "photostream:notifications-updated";
const maxTimerDelayMs = 2_000_000_000;

function dismissalKey(notificationId: string): string {
  return `photostream:album-notification-dismissed:${notificationId}`;
}

function storageSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "seen";
  } catch {
    return false;
  }
}

function notificationDismissed(notificationId: string): boolean {
  try {
    return window.localStorage.getItem(dismissalKey(notificationId)) === "1";
  } catch {
    return false;
  }
}

function markNotificationDismissed(notificationId: string): void {
  try {
    window.localStorage.setItem(dismissalKey(notificationId), "1");
  } catch {
    // The current page still suppresses the notification after it is closed.
  }
}

function priorityReady(): boolean {
  return storageSeen(viewerServiceNoticeStorageKey) && storageSeen(viewerOnboardingStorageKey);
}

function formatEndTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function ViewerNotifications({ slug }: Readonly<{ slug: string }>) {
  const [notificationState, setNotificationState] = useState<PublicAlbumNotificationState>({
    items: [],
    nextChangeAt: null,
  });
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState<AlbumNotificationView | null>(null);
  const [neverShowAgain, setNeverShowAgain] = useState(false);
  const shownThisVisitRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const next = await clientGet<PublicAlbumNotificationState>(
        `/api/v1/public/albums/${encodeURIComponent(slug)}/notifications`,
      );
      setNotificationState(next);
    } catch {
      // Notifications are supplementary; gallery browsing must remain available if this request fails.
    }
  }, [slug]);

  useEffect(() => {
    shownThisVisitRef.current.clear();
    setCurrent(null);
    setNeverShowAgain(false);
    setReady(priorityReady());
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const updatePriority = () => setReady(priorityReady());
    window.addEventListener(viewerServiceNoticeDismissedEvent, updatePriority);
    window.addEventListener(viewerOnboardingDismissedEvent, updatePriority);
    return () => {
      window.removeEventListener(viewerServiceNoticeDismissedEvent, updatePriority);
      window.removeEventListener(viewerOnboardingDismissedEvent, updatePriority);
    };
  }, []);

  useEffect(() => {
    const changed = () => void refresh();
    window.addEventListener(notificationUpdatedEvent, changed);
    window.addEventListener("focus", changed);
    window.addEventListener("pageshow", changed);
    return () => {
      window.removeEventListener(notificationUpdatedEvent, changed);
      window.removeEventListener("focus", changed);
      window.removeEventListener("pageshow", changed);
    };
  }, [refresh]);

  useEffect(() => {
    if (notificationState.nextChangeAt === null) return;
    const delay = Math.max(
      0,
      Math.min(
        maxTimerDelayMs,
        new Date(notificationState.nextChangeAt).getTime() - Date.now() + 150,
      ),
    );
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [notificationState.nextChangeAt, refresh]);

  useEffect(() => {
    if (current !== null) {
      if (!notificationState.items.some((item) => item.id === current.id)) {
        shownThisVisitRef.current.add(current.id);
        setCurrent(null);
        setNeverShowAgain(false);
      }
      return;
    }
    if (!ready) return;

    const next = notificationState.items.find(
      (item) => !shownThisVisitRef.current.has(item.id) && !notificationDismissed(item.id),
    );
    if (next === undefined) return;
    setNeverShowAgain(false);
    setCurrent(next);
  }, [current, notificationState.items, ready]);

  function closeCurrent(): void {
    if (current === null) return;
    shownThisVisitRef.current.add(current.id);
    if (neverShowAgain) markNotificationDismissed(current.id);
    setCurrent(null);
    setNeverShowAgain(false);
  }

  return (
    <Dialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) closeCurrent();
      }}
    >
      <DialogContent
        className="public-theme max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-md"
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <BellIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-muted-foreground">活动通知</p>
              <DialogTitle className="text-left leading-6">{current?.title ?? ""}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <DialogDescription className="max-h-[48dvh] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-foreground">
          {current?.content ?? ""}
        </DialogDescription>

        {current === null ? null : (
          <p className="text-xs text-muted-foreground">
            本通知生效至 {formatEndTime(current.endsAt)}（北京时间）
          </p>
        )}

        <DialogFooter className="gap-3 sm:flex-col sm:items-stretch">
          <label
            className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
            htmlFor="viewer-notification-never-show-again"
          >
            <Checkbox
              checked={neverShowAgain}
              id="viewer-notification-never-show-again"
              onCheckedChange={setNeverShowAgain}
            />
            <span>不再提示此通知</span>
          </label>
          <Button className="w-full" onClick={closeCurrent} type="button">
            我知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
