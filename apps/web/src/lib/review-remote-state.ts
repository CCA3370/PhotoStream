import type { InternalMediaView } from "@photostream/contracts";

import type { LocalReviewPhoto } from "./local-review-queue";

export function isStandaloneLocalReviewPhoto(
  photo: Pick<LocalReviewPhoto, "uploadState" | "mediaId">,
  remoteIds: ReadonlySet<string>,
): boolean {
  return (
    (photo.uploadState === "local" || photo.uploadState === "failed") &&
    (photo.mediaId === null || !remoteIds.has(photo.mediaId))
  );
}

export interface ReviewRemotePage {
  readonly items: readonly InternalMediaView[];
  readonly nextCursor: string | null;
}

export interface ReviewRemoteFrontier {
  readonly id: string;
  readonly createdAt: string;
}

export function reviewRemoteFrontier(
  items: readonly InternalMediaView[],
): ReviewRemoteFrontier | null {
  return items.at(-1) ?? null;
}

export async function fetchReviewRemoteWindow(
  fetchPage: (cursor?: string) => Promise<ReviewRemotePage>,
  frontier: ReviewRemoteFrontier | null,
  sort: "newest" | "oldest",
): Promise<ReviewRemotePage> {
  const items = new Map<string, InternalMediaView>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const page = await fetchPage(cursor);
    for (const item of page.items) items.set(item.id, item);
    const last = reviewRemoteFrontier(page.items);
    const position =
      last === null || frontier === null ? 0 : last.createdAt.localeCompare(frontier.createdAt);
    // DTO dates omit PostgreSQL microseconds, so UUID ordering cannot distinguish a shared ms.
    const reached =
      frontier !== null &&
      (items.has(frontier.id) || (sort === "newest" ? position < 0 : position > 0));
    if (frontier === null || page.nextCursor === null || reached) {
      return { items: [...items.values()], nextCursor: page.nextCursor };
    }
    if (last === null || cursors.has(page.nextCursor)) {
      throw new Error("审核列表分页异常，请刷新后重试");
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function stableRemoteMedia(
  previous: InternalMediaView | undefined,
  incoming: InternalMediaView,
  reviewed: ReadonlyMap<string, string>,
): InternalMediaView {
  const reviewedAt = incoming.reviewedAt ?? reviewed.get(incoming.id);
  const next = reviewedAt === undefined ? incoming : { ...incoming, reviewedAt };
  if (
    previous === undefined ||
    (previous.edit?.activeRevisionId ?? null) !== (incoming.edit?.activeRevisionId ?? null)
  ) {
    return next;
  }
  const previousByKind = new Map(previous.variants.map((variant) => [variant.kind, variant]));
  const stabilized = {
    ...next,
    variants: next.variants.map((variant) => {
      const existing = previousByKind.get(variant.kind);
      if (
        existing === undefined ||
        existing.bytes !== variant.bytes ||
        existing.width !== variant.width ||
        existing.height !== variant.height ||
        existing.contentType !== variant.contentType
      ) {
        return variant;
      }
      return { ...variant, url: existing.url };
    }),
  };
  return JSON.stringify(previous) === JSON.stringify(stabilized) ? previous : stabilized;
}

export function reconcileRemotePage(
  current: readonly InternalMediaView[],
  incoming: readonly InternalMediaView[],
  openKeys: ReadonlySet<string>,
  reviewed: ReadonlyMap<string, string>,
): readonly InternalMediaView[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const next = incoming.map((item) => stableRemoteMedia(currentById.get(item.id), item, reviewed));
  const present = new Set(next.map((item) => item.id));
  for (const item of current) {
    if (present.has(item.id)) continue;
    if (openKeys.has(`remote:${item.id}`)) next.push(item);
  }
  if (next.length === current.length && next.every((item, index) => item === current[index])) {
    return current;
  }
  return next;
}

export function mergeRemote(
  current: readonly InternalMediaView[],
  incoming: readonly InternalMediaView[],
  reviewed: ReadonlyMap<string, string>,
): readonly InternalMediaView[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming)
    byId.set(item.id, stableRemoteMedia(byId.get(item.id), item, reviewed));
  return [...byId.values()];
}

interface ReviewRemoteRequest {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
}

/** Serialize pagination and refresh within a filter; retire previous filters immediately. */
export class ReviewRemoteRequests {
  #scope: string | null = null;
  #controller = new AbortController();
  #pending: Promise<void> = Promise.resolve();

  setScope(scope: string): boolean {
    if (this.#scope === scope && !this.#controller.signal.aborted) return false;
    this.#controller.abort();
    this.#scope = scope;
    this.#controller = new AbortController();
    this.#pending = Promise.resolve();
    return true;
  }

  cancel(): void {
    this.#controller.abort();
  }

  isScope(scope: string): boolean {
    return this.#scope === scope && !this.#controller.signal.aborted;
  }

  run(scope: string, operation: (request: ReviewRemoteRequest) => Promise<void>): Promise<void> {
    const controller = this.#controller;
    const isCurrent = () =>
      this.#scope === scope && this.#controller === controller && !controller.signal.aborted;
    const pending = this.#pending.then(async () => {
      if (!isCurrent()) return;
      try {
        await operation({ signal: controller.signal, isCurrent });
      } catch (cause) {
        if (isCurrent()) throw cause;
      }
    });
    this.#pending = pending.catch(() => undefined);
    return pending;
  }
}
