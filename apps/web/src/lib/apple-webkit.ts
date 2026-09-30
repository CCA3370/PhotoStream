"use client";

const safariProcessingMarkerPrefix = "photostream:safari-processing-active:";
const markerMaxAgeMs = 15 * 60 * 1000;

function currentNavigator(): Navigator | null {
  return typeof navigator === "undefined" ? null : navigator;
}

/**
 * Safari on macOS plus every browser running on iPhone/iPad.
 * iOS browsers share WebKit's process and memory constraints, so the
 * conservative compatibility path is engine/device based.
 */
export function isAppleWebKit(): boolean {
  const value = currentNavigator();
  if (value === null) return false;
  const ua = value.userAgent;
  const appleMobile =
    /iPad|iPhone|iPod/i.test(ua) ||
    (value.platform === "MacIntel" && value.maxTouchPoints > 1);
  if (appleMobile) return true;
  return /AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/i.test(ua);
}

export function isAppleMobileWebKit(): boolean {
  const value = currentNavigator();
  if (value === null) return false;
  return (
    /iPad|iPhone|iPod/i.test(value.userAgent) ||
    (value.platform === "MacIntel" && value.maxTouchPoints > 1)
  );
}

function markerKey(albumId: string): string {
  return `${safariProcessingMarkerPrefix}${albumId}`;
}

export function markSafariProcessingActive(albumId: string): void {
  if (!isAppleWebKit() || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(markerKey(albumId), String(Date.now()));
  } catch {
    // Managed/private Safari sessions can deny storage access.
  }
}

export function clearSafariProcessingActive(albumId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(markerKey(albumId));
  } catch {
    // Best-effort crash marker only.
  }
}

export function consumeSafariInterruptedProcessing(albumId: string): boolean {
  if (!isAppleWebKit() || typeof window === "undefined") return false;
  try {
    const key = markerKey(albumId);
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return false;
    window.sessionStorage.removeItem(key);
    const timestamp = Number(raw);
    if (!Number.isFinite(timestamp)) return false;
    const age = Date.now() - timestamp;
    return age >= 0 && age < markerMaxAgeMs;
  } catch {
    return false;
  }
}
