import type { BibConfigView, BibMediaState, BibTagView } from "@photostream/contracts";
import { normalizeBibCandidates } from "@photostream/contracts";

import { BIB_OCR_ASSET_VERSION, bibOcrSupported, recognizeBibCandidates } from "./bib-ocr";
import { clientGet, clientMutation } from "./client-api";
import {
  getLocalReviewPhoto,
  type LocalBibState,
  type LocalReviewPhoto,
  listLocalReviewPhotos,
  updateLocalReviewPhoto,
} from "./local-review-queue";

export const LOCAL_BIB_SERVER_STATE_EVENT = "photostream:local-bib-server-state";

const ocrJobs = new Map<string, Promise<void>>();
const ocrControllers = new Map<string, AbortController>();
const desiredOcrConfigs = new Map<string, BibConfigView>();
const syncTails = new Map<string, Promise<void>>();

function configRevision(config: BibConfigView): string {
  return `${config.recognitionEnabled}:${config.modelVersion}:${config.ruleVersion}`;
}

function configStillDesired(photoId: string, config: BibConfigView): boolean {
  const desired = desiredOcrConfigs.get(photoId);
  return desired === undefined || configRevision(desired) === configRevision(config);
}

function jobObsolete(photoId: string, config: BibConfigView, signal: AbortSignal): boolean {
  return signal.aborted || !configStillDesired(photoId, config);
}

function serverStateChanged(photo: LocalReviewPhoto, state: BibMediaState): void {
  window.dispatchEvent(
    new CustomEvent(LOCAL_BIB_SERVER_STATE_EVENT, {
      detail: { albumId: photo.albumId, mediaId: photo.mediaId, state },
    }),
  );
}

function nextOcrState(current: LocalBibState, change: Partial<LocalBibState>): LocalBibState {
  return {
    ...current,
    ...change,
    ocrRevision: current.ocrRevision + 1,
  };
}

async function updateOcrState(
  photoId: string,
  change: Partial<LocalBibState>,
): Promise<LocalReviewPhoto> {
  return updateLocalReviewPhoto(photoId, (current) => ({
    ...current,
    bib: nextOcrState(current.bib, change),
  }));
}

async function serialSync<T>(photoId: string, operation: () => Promise<T>): Promise<T> {
  const previous = syncTails.get(photoId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  syncTails.set(photoId, tail);
  try {
    await previous;
    return await operation();
  } finally {
    release();
    void tail.finally(() => {
      if (syncTails.get(photoId) === tail) syncTails.delete(photoId);
    });
  }
}

function ocrActivityStatus(
  status: LocalBibState["ocrStatus"],
): "processing" | "completed" | "failed" | "unsupported" | null {
  if (status === "processing") return "processing";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "unsupported") return "unsupported";
  return null;
}

async function syncOcr(
  photo: LocalReviewPhoto,
  config: BibConfigView,
): Promise<BibMediaState | null> {
  if (photo.mediaId === null || !config.recognitionEnabled) return null;
  if (photo.bib.ocrRevision <= photo.bib.ocrSyncedRevision) return null;
  const modelVersion = photo.bib.modelVersion;
  const ruleVersion = photo.bib.ruleVersion;
  if (
    modelVersion === null ||
    ruleVersion === null ||
    modelVersion !== config.modelVersion ||
    ruleVersion !== config.ruleVersion
  ) {
    return null;
  }
  const activityStatus = ocrActivityStatus(photo.bib.ocrStatus);
  if (activityStatus === null) return null;
  const revision = photo.bib.ocrRevision;
  const state = await clientMutation<BibMediaState>(
    `/api/v1/media/${photo.mediaId}/bib-candidates`,
    {
      body: {
        activityStatus,
        modelVersion,
        ruleVersion,
        candidates: activityStatus === "completed" ? photo.bib.candidates : [],
      },
      idempotencyKey: `local-bib-ocr-${photo.id}-${revision}-${activityStatus}`,
    },
  );
  await updateLocalReviewPhoto(photo.id, (current) =>
    current.bib.ocrRevision === revision
      ? {
          ...current,
          bib: { ...current.bib, ocrSyncedRevision: revision },
        }
      : current,
  );
  serverStateChanged(photo, state);
  return state;
}

async function exactConfirmedNumbers(
  photo: LocalReviewPhoto,
  initial: BibMediaState,
): Promise<BibMediaState> {
  if (photo.mediaId === null) return initial;
  const wanted = new Set(photo.bib.confirmedNumbers);
  let current = initial;
  if (current.review.decision === "no_number_confirmed") {
    current = await clientMutation<BibMediaState>(
      `/api/v1/media/${photo.mediaId}/bib-review/reset`,
      { idempotencyKey: `local-bib-manual-${photo.id}-${photo.bib.manualRevision}-reset` },
    );
  }
  for (const tag of current.tags.filter(
    (candidate) => candidate.status === "confirmed" && !wanted.has(candidate.number),
  )) {
    current = await clientMutation<BibMediaState>(
      `/api/v1/media/${photo.mediaId}/bib-tags/${tag.id}`,
      {
        method: "DELETE",
        idempotencyKey: `local-bib-manual-${photo.id}-${photo.bib.manualRevision}-delete-${tag.id}`,
      },
    );
  }
  for (const [index, number] of photo.bib.confirmedNumbers.entries()) {
    if (current.tags.some((tag) => tag.status === "confirmed" && tag.number === number)) continue;
    const candidate: BibTagView | undefined = current.tags.find(
      (tag) =>
        tag.number === number && (tag.status === "suggested" || tag.status === "needs_review"),
    );
    current =
      candidate === undefined
        ? await clientMutation<BibMediaState>(`/api/v1/media/${photo.mediaId}/bib-tags`, {
            body: { number },
            idempotencyKey: `local-bib-manual-${photo.id}-${photo.bib.manualRevision}-add-${index}`,
          })
        : await clientMutation<BibMediaState>(
            `/api/v1/media/${photo.mediaId}/bib-tags/${candidate.id}/confirm`,
            {
              body: {},
              idempotencyKey: `local-bib-manual-${photo.id}-${photo.bib.manualRevision}-confirm-${index}`,
            },
          );
  }
  return current;
}

async function syncManual(
  photo: LocalReviewPhoto,
  initial: BibMediaState | null,
): Promise<BibMediaState | null> {
  if (photo.mediaId === null || photo.bib.decision === "pending") return initial;
  if (photo.bib.manualRevision <= photo.bib.manualSyncedRevision) return initial;
  const revision = photo.bib.manualRevision;
  let current = initial ?? (await clientGet<BibMediaState>(`/api/v1/media/${photo.mediaId}/bib`));
  if (photo.bib.decision === "no_number_confirmed") {
    if (current.review.decision !== "no_number_confirmed") {
      current = await clientMutation<BibMediaState>(
        `/api/v1/media/${photo.mediaId}/bib-review/no-number`,
        { idempotencyKey: `local-bib-manual-${photo.id}-${revision}-no-number` },
      );
    }
  } else {
    current = await exactConfirmedNumbers(photo, current);
  }
  await updateLocalReviewPhoto(photo.id, (latest) =>
    latest.bib.manualRevision === revision
      ? {
          ...latest,
          bib: { ...latest.bib, manualSyncedRevision: revision },
        }
      : latest,
  );
  serverStateChanged(photo, current);
  return current;
}

export async function syncLocalBibToServer(photoId: string, config: BibConfigView): Promise<void> {
  await serialSync(photoId, async () => {
    const photo = await getLocalReviewPhoto(photoId);
    if (photo === null || photo.mediaId === null) return;
    let state: BibMediaState | null = null;
    try {
      state = await syncOcr(photo, config);
    } catch (error) {
      console.warn("Local bib OCR state sync failed", error);
    }
    const latest = await getLocalReviewPhoto(photoId);
    if (latest === null || latest.mediaId === null) return;
    try {
      await syncManual(latest, state);
    } catch (error) {
      console.warn("Local bib manual state sync failed", error);
    }
  });
}

export function shouldResumeLocalBibOcr(photo: LocalReviewPhoto, config: BibConfigView): boolean {
  if (!config.recognitionEnabled) return photo.bib.ocrStatus !== "disabled";
  if (
    photo.bib.ocrStatus === "not_started" ||
    photo.bib.ocrStatus === "processing" ||
    photo.bib.ocrStatus === "disabled"
  ) {
    return true;
  }
  return (
    photo.bib.modelVersion !== config.modelVersion || photo.bib.ruleVersion !== config.ruleVersion
  );
}

async function runLocalBibOcr(
  photoId: string,
  config: BibConfigView,
  signal: AbortSignal,
): Promise<void> {
  const photo = await getLocalReviewPhoto(photoId);
  if (photo === null || jobObsolete(photoId, config, signal)) return;
  if (!config.recognitionEnabled) {
    if (jobObsolete(photoId, config, signal)) return;
    if (photo.bib.ocrStatus !== "disabled") {
      await updateOcrState(photoId, {
        ocrStatus: "disabled",
        modelVersion: config.modelVersion,
        ruleVersion: config.ruleVersion,
        candidates: [],
        ocrError: null,
      });
    }
    await syncLocalBibToServer(photoId, config);
    return;
  }
  if (config.modelVersion !== BIB_OCR_ASSET_VERSION) {
    if (jobObsolete(photoId, config, signal)) return;
    await updateOcrState(photoId, {
      ocrStatus: "failed",
      modelVersion: config.modelVersion,
      ruleVersion: config.ruleVersion,
      candidates: [],
      ocrError: "浏览器 OCR 模型版本与相册配置不一致",
    });
    return;
  }
  if (!bibOcrSupported()) {
    if (jobObsolete(photoId, config, signal)) return;
    await updateOcrState(photoId, {
      ocrStatus: "unsupported",
      modelVersion: BIB_OCR_ASSET_VERSION,
      ruleVersion: config.ruleVersion,
      candidates: [],
      ocrError: null,
    });
    await syncLocalBibToServer(photoId, config);
    return;
  }
  const workingImage = photo.variants.find((variant) => variant.kind === "photo_1920")?.blob;
  if (workingImage === undefined) {
    if (jobObsolete(photoId, config, signal)) return;
    await updateOcrState(photoId, {
      ocrStatus: "failed",
      modelVersion: BIB_OCR_ASSET_VERSION,
      ruleVersion: config.ruleVersion,
      candidates: [],
      ocrError: "缺少 OCR 工作图",
    });
    await syncLocalBibToServer(photoId, config);
    return;
  }

  if (jobObsolete(photoId, config, signal)) return;
  await updateOcrState(photoId, {
    ocrStatus: "processing",
    modelVersion: BIB_OCR_ASSET_VERSION,
    ruleVersion: config.ruleVersion,
    candidates: [],
    ocrError: null,
  });
  await syncLocalBibToServer(photoId, config);
  if (jobObsolete(photoId, config, signal)) return;
  try {
    const rawCandidates = await recognizeBibCandidates(workingImage, signal);
    if (jobObsolete(photoId, config, signal)) return;
    const candidates = normalizeBibCandidates(rawCandidates, config.patterns).map(
      ({ number, ...candidate }) => ({ ...candidate, text: number }),
    );
    await updateOcrState(photoId, {
      ocrStatus: "completed",
      modelVersion: BIB_OCR_ASSET_VERSION,
      ruleVersion: config.ruleVersion,
      candidates,
      ocrError: null,
    });
  } catch (error) {
    if (signal.aborted || !configStillDesired(photoId, config)) return;
    await updateOcrState(photoId, {
      ocrStatus: "failed",
      modelVersion: BIB_OCR_ASSET_VERSION,
      ruleVersion: config.ruleVersion,
      candidates: [],
      ocrError: error instanceof Error ? error.message : "OCR 识别失败",
    });
  }
  await syncLocalBibToServer(photoId, config);
}

function queueOcr(photoId: string, config: BibConfigView): void {
  const previousDesired = desiredOcrConfigs.get(photoId);
  const revisionChanged =
    previousDesired !== undefined && configRevision(previousDesired) !== configRevision(config);
  desiredOcrConfigs.set(photoId, config);
  if (ocrJobs.has(photoId)) {
    if (revisionChanged) ocrControllers.get(photoId)?.abort();
    return;
  }
  const startedRevision = configRevision(config);
  const controller = new AbortController();
  ocrControllers.set(photoId, controller);
  const job = runLocalBibOcr(photoId, config, controller.signal).catch((error) => {
    if (!controller.signal.aborted) console.warn("Local bib OCR job failed", error);
  });
  ocrJobs.set(photoId, job);
  void job.finally(() => {
    if (ocrJobs.get(photoId) !== job) return;
    ocrJobs.delete(photoId);
    if (ocrControllers.get(photoId) === controller) ocrControllers.delete(photoId);
    const desired = desiredOcrConfigs.get(photoId);
    if (desired !== undefined && configRevision(desired) !== startedRevision) {
      queueOcr(photoId, desired);
      return;
    }
    desiredOcrConfigs.delete(photoId);
  });
}

export function startLocalBibOcr(photoId: string, config: BibConfigView): void {
  queueOcr(photoId, config);
}

export async function resumeLocalBibOcr(albumId: string, config: BibConfigView): Promise<void> {
  const photos = await listLocalReviewPhotos(albumId);
  for (const photo of photos) {
    if (photo.mediaId !== null) void syncLocalBibToServer(photo.id, config);
    if (shouldResumeLocalBibOcr(photo, config)) queueOcr(photo.id, config);
  }
}
