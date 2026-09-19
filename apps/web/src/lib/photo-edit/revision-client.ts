import type {
  CreateMediaEditRevisionRequest,
  MediaEditContextView,
  MediaEditVariantKind,
  PrepareMediaEditRevisionRequest,
  SignedUpload,
} from "@photostream/contracts";

import { clientGet, clientMutation } from "../client-api";
import { type PhotoEditRecipe, photoEditPipelineVersion, photoEditRecipeVersion } from "./recipe";
import { type PhotoEditRenderedOutput, renderMediaEditOutputs } from "./runtime";

async function renderRecipeOutputs(options: {
  readonly source: Blob;
  readonly recipe: PhotoEditRecipe;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}): Promise<readonly PhotoEditRenderedOutput[]> {
  return renderMediaEditOutputs(options.source, options.recipe, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    onProgress: (progress) => options.onProgress?.(progress),
  });
}

function outputByKind(
  outputs: readonly PhotoEditRenderedOutput[],
  kind: MediaEditVariantKind,
): PhotoEditRenderedOutput {
  const output = outputs.find((candidate) => candidate.kind === kind);
  if (output === undefined) throw new Error(`修图输出缺少 ${kind}`);
  return output;
}

async function uploadOutput(
  mediaId: string,
  revisionId: string,
  output: PhotoEditRenderedOutput,
  signal?: AbortSignal,
): Promise<void> {
  const basePath = `/api/v1/media/${encodeURIComponent(mediaId)}/edits/${encodeURIComponent(revisionId)}/variants/${output.kind}`;
  const signed = await clientMutation<SignedUpload>(`${basePath}/sign`, {
    ...(signal === undefined ? {} : { signal }),
  });
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: output.blob,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`修图对象上传失败（${response.status}）`);
  }
  await clientMutation<{ readonly ok: true }>(`${basePath}/complete`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function getMediaEditContext(
  mediaId: string,
  signal?: AbortSignal,
): Promise<MediaEditContextView> {
  return clientGet<MediaEditContextView>(
    `/api/v1/media/${encodeURIComponent(mediaId)}/edit-context`,
    signal,
  );
}

export async function switchMediaEditRevision(options: {
  readonly mediaId: string;
  readonly expectedGeneration: number;
  readonly expectedActiveRevisionId: string | null;
  readonly targetRevisionId: string | null;
  readonly signal?: AbortSignal;
}): Promise<MediaEditContextView> {
  return clientMutation<MediaEditContextView>(
    `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits/revert`,
    {
      body: {
        expectedGeneration: options.expectedGeneration,
        expectedActiveRevisionId: options.expectedActiveRevisionId,
        targetRevisionId: options.targetRevisionId,
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
}

export function failPendingMediaEditRevision(options: {
  readonly mediaId: string;
  readonly revisionId: string;
}): Promise<MediaEditContextView> {
  return clientMutation<MediaEditContextView>(
    `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits/${encodeURIComponent(options.revisionId)}/fail`,
  );
}

export function cancelPendingMediaEditRevision(options: {
  readonly mediaId: string;
  readonly revisionId: string;
  readonly signal?: AbortSignal;
}): Promise<MediaEditContextView> {
  return clientMutation<MediaEditContextView>(
    `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits/${encodeURIComponent(options.revisionId)}/cancel`,
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
}

export function revertMediaEditToBase(options: {
  readonly mediaId: string;
  readonly expectedGeneration: number;
  readonly expectedActiveRevisionId: string | null;
  readonly signal?: AbortSignal;
}): Promise<MediaEditContextView> {
  return switchMediaEditRevision({ ...options, targetRevisionId: null });
}

export async function applyMediaEditRecipe(options: {
  readonly mediaId: string;
  readonly recipe: PhotoEditRecipe;
  readonly source: Blob;
  readonly basedOnGeneration: number;
  readonly basedOnRevisionId: string | null;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
  readonly onReserved?: (revisionId: string) => void | Promise<void>;
  readonly preservePendingOnFailure?: boolean;
}): Promise<MediaEditContextView> {
  options.onProgress?.(0);
  const reserveRequest: CreateMediaEditRevisionRequest = {
    basedOnRevisionId: options.basedOnRevisionId,
    basedOnGeneration: options.basedOnGeneration,
    pipelineVersion: photoEditPipelineVersion,
    recipeVersion: photoEditRecipeVersion,
    recipeJson: { ...options.recipe },
  };

  const reserved = await clientMutation<MediaEditContextView>(
    `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits`,
    {
      body: reserveRequest,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  const revisionId = reserved.state.pendingRevisionId;
  if (revisionId === null) throw new Error("修图版本预留失败");

  try {
    await options.onReserved?.(revisionId);
    options.onProgress?.(0.02);
    const outputs = await renderRecipeOutputs({
      source: options.source,
      recipe: options.recipe,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onProgress: (progress) => options.onProgress?.(0.02 + progress * 0.68),
    });

    const orderedKinds: readonly MediaEditVariantKind[] = [
      "photo_480",
      "photo_960",
      "photo_1920",
      "photo_download",
    ];
    const prepareRequest: PrepareMediaEditRevisionRequest = {
      variants: orderedKinds.map((kind) => {
        const output = outputByKind(outputs, kind);
        return {
          kind,
          format: output.format,
          contentType: output.contentType,
          width: output.width,
          height: output.height,
          bytes: output.blob.size,
        };
      }),
    };
    await clientMutation<MediaEditContextView>(
      `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits/${encodeURIComponent(revisionId)}/prepare`,
      {
        body: prepareRequest,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    options.onProgress?.(0.72);

    for (let index = 0; index < orderedKinds.length; index += 1) {
      const kind = orderedKinds[index] ?? "photo_480";
      await uploadOutput(options.mediaId, revisionId, outputByKind(outputs, kind), options.signal);
      options.onProgress?.(0.72 + ((index + 1) / orderedKinds.length) * 0.2);
    }

    const ready = await clientMutation<MediaEditContextView>(
      `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits/${encodeURIComponent(revisionId)}/complete`,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    options.onProgress?.(0.95);

    const applied = await clientMutation<MediaEditContextView>(
      `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits/${encodeURIComponent(revisionId)}/apply`,
      {
        body: {
          expectedGeneration: ready.state.generation,
          expectedActiveRevisionId: options.basedOnRevisionId,
        },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    options.onProgress?.(1);
    return applied;
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    if (aborted || options.preservePendingOnFailure !== true) {
      await cancelPendingMediaEditRevision({
        mediaId: options.mediaId,
        revisionId,
      }).catch(() => undefined);
    } else {
      await failPendingMediaEditRevision({
        mediaId: options.mediaId,
        revisionId,
      }).catch(() => undefined);
    }
    throw error;
  }
}
