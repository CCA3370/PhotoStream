"use client";

import type { AlbumNotificationView, PublicAlbumNotificationState } from "@photostream/contracts";
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
const retryDelayMs = 3_000;

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

export function ViewerNotifications({
  onboardingRequired = true,
  slug,
}: Readonly<{ onboardingRequired?: boolean; slug: string }>) {
  const [notificationState, setNotificationState] = useState<PublicAlbumNotificationState | null>(
    null,
  );
  const [serviceNoticeReady, setServiceNoticeReady] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(!onboardingRequired);
  const [current, setCurrent] = useState<AlbumNotificationView | null>(null);
  const [neverShowAgain, setNeverShowAgain] = useState(false);
  const shownThisVisitRef = useRef(new Set<string>());

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const next = await clientGet<PublicAlbumNotificationState>(
        `/api/v1/public/albums/${encodeURIComponent(slug)}/notifications`,
      );
      setNotificationState(next);
      return true;
    } catch {
      // Notifications are supplementary; gallery browsing must remain available if this request fails.
      return false;
    }
  }, [slug]);

  useEffect(() => {
    shownThisVisitRef.current.clear();
    setCurrent(null);
    setNeverShowAgain(false);
    setNotificationState(null);
    setServiceNoticeReady(storageSeen(viewerServiceNoticeStorageKey));
    setOnboardingReady(!onboardingRequired || storageSeen(viewerOnboardingStorageKey));

    let cancelled = false;
    let retryTimer: number | undefined;
    const load = async () => {
      const succeeded = await refresh();
      if (!succeeded && !cancelled) {
        retryTimer = window.setTimeout(() => void load(), retryDelayMs);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [onboardingRequired, refresh]);

  useEffect(() => {
    const serviceNoticeDismissed = () => setServiceNoticeReady(true);
    const onboardingDismissed = () => setOnboardingReady(true);
    window.addEventListener(viewerServiceNoticeDismissedEvent, serviceNoticeDismissed);
    window.addEventListener(viewerOnboardingDismissedEvent, onboardingDismissed);
    return () => {
      window.removeEventListener(viewerServiceNoticeDismissedEvent, serviceNoticeDismissed);
      window.removeEventListener(viewerOnboardingDismissedEvent, onboardingDismissed);
    };
  }, []);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const changed = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), Math.floor(Math.random() * 250));
    };
    window.addEventListener(notificationUpdatedEvent, changed);
    window.addEventListener("focus", changed);
    window.addEventListener("pageshow", changed);
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      window.removeEventListener(notificationUpdatedEvent, changed);
      window.removeEventListener("focus", changed);
      window.removeEventListener("pageshow", changed);
    };
  }, [refresh]);

  useEffect(() => {
    if (notificationState?.nextChangeAt === null || notificationState === null) return;

    const serverNow = new Date(notificationState.serverNow).getTime();
    const nextChangeAt = new Date(notificationState.nextChangeAt).getTime();
    const delay = Math.max(0, Math.min(maxTimerDelayMs, nextChangeAt - serverNow + 150));
    let cancelled = false;
    let timer: number | undefined;
    let retryTimer: number | undefined;

    const refreshAtBoundary = async () => {
      const succeeded = await refresh();
      if (!succeeded && !cancelled) {
        retryTimer = window.setTimeout(() => void refreshAtBoundary(), retryDelayMs);
      }
    };
    timer = window.setTimeout(() => void refreshAtBoundary(), delay);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [notificationState, refresh]);

  const ready = serviceNoticeReady && (!onboardingRequired || onboardingReady);

  useEffect(() => {
    if (current !== null) {
      if (!notificationState?.items.some((item) => item.id === current.id)) {
        shownThisVisitRef.current.add(current.id);
        setCurrent(null);
        setNeverShowAgain(false);
      }
      return;
    }
    if (!ready || notificationState === null) return;

    const next = notificationState.items.find(
      (item) => !shownThisVisitRef.current.has(item.id) && !notificationDismissed(item.id),
    );
    if (next === undefined) return;
    setNeverShowAgain(false);
    setCurrent(next);
  }, [current, notificationState, ready]);

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

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:items-stretch">
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
