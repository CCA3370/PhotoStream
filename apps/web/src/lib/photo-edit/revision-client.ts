import type {
  CreateMediaEditRevisionRequest,
  MediaEditContextView,
  MediaEditVariantKind,
  SignedUpload,
} from "@photostream/contracts";

import { clientGet, clientMutation } from "../client-api";
import type { PhotoEditRecipe } from "./recipe";
import { photoEditPipelineVersion, photoEditRecipeVersion } from "./recipe";
import { renderMediaEditOutputs, type PhotoEditRenderedOutput } from "./runtime";

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

export async function applyMediaEditRecipe(options: {
  readonly mediaId: string;
  readonly recipe: PhotoEditRecipe;
  readonly source: Blob;
  readonly basedOnGeneration: number;
  readonly basedOnRevisionId: string | null;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}): Promise<MediaEditContextView> {
  options.onProgress?.(0);
  const outputs = await renderMediaEditOutputs(options.source, options.recipe, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    onProgress: (progress) => options.onProgress?.(progress * 0.72),
  });

  const orderedKinds: readonly MediaEditVariantKind[] = [
    "photo_480",
    "photo_960",
    "photo_1920",
    "photo_download",
  ];
  const request: CreateMediaEditRevisionRequest = {
    basedOnRevisionId: options.basedOnRevisionId,
    basedOnGeneration: options.basedOnGeneration,
    pipelineVersion: photoEditPipelineVersion,
    recipeVersion: photoEditRecipeVersion,
    recipeJson: { ...options.recipe },
    denoiseModel: null,
    denoiseModelVersion: null,
    deblurModel: null,
    deblurModelVersion: null,
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

  const created = await clientMutation<MediaEditContextView>(
    `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits`,
    {
      body: request,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  const revisionId = created.state.pendingRevisionId;
  if (revisionId === null) throw new Error("修图版本创建失败");

  try {
    for (let index = 0; index < orderedKinds.length; index += 1) {
      const kind = orderedKinds[index] ?? "photo_480";
      await uploadOutput(
        options.mediaId,
        revisionId,
        outputByKind(outputs, kind),
        options.signal,
      );
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
    await clientMutation(
      `/api/v1/media/${encodeURIComponent(options.mediaId)}/edits/${encodeURIComponent(revisionId)}/cancel`,
      {},
    ).catch(() => undefined);
    throw error;
  }
}
