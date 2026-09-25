export interface AlbumPurgeNotice {
  readonly albumId: string;
  readonly slug: string;
}

const channelName = "photostream-album-purge-v1";
const storageKey = "photostream:album-purge:v1";
const listeners = new Set<(notice: AlbumPurgeNotice) => void>();
let initialized = false;
let channel: BroadcastChannel | null = null;

function parsedNotice(value: unknown): AlbumPurgeNotice | null {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { albumId?: unknown }).albumId !== "string" ||
    typeof (value as { slug?: unknown }).slug !== "string"
  ) {
    return null;
  }
  const notice = value as { albumId: string; slug: string };
  if (notice.albumId.length === 0 || notice.slug.length === 0) return null;
  return { albumId: notice.albumId, slug: notice.slug };
}

function emit(notice: AlbumPurgeNotice): void {
  for (const listener of listeners) listener(notice);
}

function initialize(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(channelName);
    channel.addEventListener("message", (event) => {
      const notice = parsedNotice(event.data);
      if (notice !== null) emit(notice);
    });
  }

  if (typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (event.key !== storageKey || event.newValue === null) return;
      try {
        const notice = parsedNotice(JSON.parse(event.newValue));
        if (notice !== null) emit(notice);
      } catch {
        // A malformed transient notice must not affect application state.
      }
    });
  }
}

export function subscribeAlbumPurge(listener: (notice: AlbumPurgeNotice) => void): () => void {
  initialize();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function broadcastAlbumPurge(notice: AlbumPurgeNotice): void {
  initialize();
  channel?.postMessage(notice);

  try {
    const payload = JSON.stringify(notice);
    window.localStorage.setItem(storageKey, payload);
    window.localStorage.removeItem(storageKey);
  } catch {
    // BroadcastChannel is the primary path; storage is only a compatibility fallback.
  }
}
