import type { MediaEditSourceView } from "@photostream/contracts";

import { clientMutation } from "../client-api";
import { findLocalReviewPhotoByMediaId } from "../local-review-queue";

export type MediaEditSourceOrigin = "local-original" | "remote-original";

export interface ResolvedMediaEditSource {
  readonly blob: Blob;
  readonly sourceOrigin: MediaEditSourceOrigin;
}

interface MediaEditSourceDependencies {
  readonly findLocal: (mediaId: string) => Promise<{ readonly originalBlob: Blob } | null>;
  readonly requestRemote: (mediaId: string) => Promise<MediaEditSourceView>;
  readonly fetchRemote: (url: string) => Promise<Response>;
}

async function defaultRemoteSource(mediaId: string): Promise<MediaEditSourceView> {
  return clientMutation<MediaEditSourceView>(
    `/api/v1/media/${encodeURIComponent(mediaId)}/edit-source`,
  );
}

const defaultDependencies: MediaEditSourceDependencies = {
  findLocal: findLocalReviewPhotoByMediaId,
  requestRemote: defaultRemoteSource,
  fetchRemote: (url) => fetch(url, { method: "GET", credentials: "omit" }),
};

export async function resolveMediaEditSource(
  mediaId: string,
  dependencies: MediaEditSourceDependencies = defaultDependencies,
): Promise<ResolvedMediaEditSource> {
  const local = await dependencies.findLocal(mediaId);
  if (local !== null) {
    return {
      blob: local.originalBlob,
      sourceOrigin: "local-original",
    };
  }

  const remote = await dependencies.requestRemote(mediaId);
  const response = await dependencies.fetchRemote(remote.url);
  if (!response.ok) {
    throw new Error(`远端原图读取失败（${response.status}）`);
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("远端原图为空");
  return {
    blob,
    sourceOrigin: "remote-original",
  };
}
