import ImmClient, {
  BatchDeleteFileMetaRequest,
  CreateDatasetRequest,
  CreateFacesSearchingTaskRequest,
  CreateFacesSearchingTaskRequestSources,
  CreateFigureClusteringTaskRequest,
  DeleteDatasetRequest,
  DetectImageFacesRequest,
  GetDatasetRequest,
  GetTaskRequest,
  IndexFileMetaRequest,
  InputFile,
  SearchImageFigureClusterRequest,
  SimpleQuery,
  SimpleQueryRequest,
} from "@alicloud/imm20200930/dist/client.js";
import { $OpenApiUtil } from "@alicloud/openapi-core";

import type { AppConfig } from "../config.js";

const ImmClientConstructor =
  (ImmClient as unknown as { default?: typeof ImmClient.default }).default ??
  (ImmClient as unknown as typeof ImmClient.default);

export type ReferenceValidation = "ok" | "no_face" | "multiple_faces" | "quality_low";
export type ProviderTaskStatus = "running" | "succeeded" | "failed";

export function classifyDetectedFaces(
  faces: readonly {
    readonly faceQuality?: number;
    readonly sharpness?: number;
    readonly boundary?: { readonly width?: number; readonly height?: number };
  }[],
  thresholds: { readonly quality: number; readonly sharpness: number; readonly faceEdge: number },
): ReferenceValidation {
  if (faces.length === 0) return "no_face";
  if (faces.length !== 1) return "multiple_faces";
  const face = faces[0];
  if (
    face === undefined ||
    (face.faceQuality ?? 0) < thresholds.quality ||
    (face.sharpness ?? 0) < thresholds.sharpness ||
    Math.min(face.boundary?.width ?? 0, face.boundary?.height ?? 0) < thresholds.faceEdge
  ) {
    return "quality_low";
  }
  return "ok";
}

export function selectQualifiedCluster(
  clusters: readonly { readonly clusterId?: string; readonly similarity?: number }[],
  threshold: number,
): string | null {
  return (
    clusters
      .filter(
        (candidate) =>
          typeof candidate.clusterId === "string" && (candidate.similarity ?? 0) >= threshold,
      )
      .sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))[0]?.clusterId ?? null
  );
}

function logClusterSimilarityResults(
  datasetName: string,
  threshold: number,
  clusters: readonly { readonly clusterId?: string; readonly similarity?: number }[],
): void {
  const candidates = clusters.map((candidate) => ({
    similarity:
      typeof candidate.similarity === "number" && Number.isFinite(candidate.similarity)
        ? candidate.similarity
        : null,
    accepted: (candidate.similarity ?? 0) >= threshold,
  }));
  const selectedSimilarity = clusters
    .filter(
      (candidate) =>
        typeof candidate.clusterId === "string" && (candidate.similarity ?? 0) >= threshold,
    )
    .sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))[0]?.similarity;
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      time: new Date().toISOString(),
      event: "face_search_similarity",
      source: "aliyun_figure_cluster",
      datasetName,
      threshold,
      candidateCount: candidates.length,
      selectedSimilarity: selectedSimilarity ?? null,
      candidates,
    })}\n`,
  );
}

export interface FaceProvider {
  createDataset(datasetName: string): Promise<void>;
  datasetExists(datasetName: string): Promise<boolean>;
  indexMedia(input: { datasetName: string; mediaId: string; uri: string }): Promise<string>;
  mediaIndexed(datasetName: string, mediaId: string): Promise<boolean>;
  deleteMedia(datasetName: string, uris: readonly string[]): Promise<void>;
  cluster(datasetName: string): Promise<string>;
  taskStatus(taskId: string, taskType: "FaceClustering"): Promise<ProviderTaskStatus>;
  validateReference(uri: string): Promise<ReferenceValidation>;
  findSynchronousCandidates(datasetName: string, referenceUri: string): Promise<string[]>;
  startAsyncSearch(datasetName: string, referenceUri: string): Promise<string>;
  deleteDatasetContents(datasetName: string): Promise<void>;
  deleteDataset(datasetName: string): Promise<void>;
}

export class UnavailableFaceProvider implements FaceProvider {
  async createDataset(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async datasetExists(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async indexMedia(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async mediaIndexed(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async deleteMedia(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async cluster(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async taskStatus(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async validateReference(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async findSynchronousCandidates(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async startAsyncSearch(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async deleteDatasetContents(): Promise<never> {
    throw new Error("face provider is disabled");
  }
  async deleteDataset(): Promise<never> {
    throw new Error("face provider is disabled");
  }
}

function required<T>(value: T | undefined, operation: string): T {
  if (value === undefined || value === "") throw new Error(`${operation} returned no identifier`);
  return value;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const status = "statusCode" in error ? Number(error.statusCode) : 0;
  return status === 404 || code === "NoSuchDataset" || code === "EntityNotExist";
}

const IMM_READ_MAX_ATTEMPTS = 3;
const IMM_READ_RETRY_DELAYS_MS = [200, 600] as const;

function errorRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function transientStatus(record: Record<string, unknown>): number | null {
  for (const candidate of [record, errorRecord(record.response), errorRecord(record.data)]) {
    if (candidate === null) continue;
    for (const key of ["statusCode", "status", "httpStatus"]) {
      const value = candidate[key];
      if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.trunc(parsed);
      }
    }
  }
  return null;
}

export function isRetryableImmReadError(error: unknown): boolean {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const record = errorRecord(current);
    if (record === null) break;
    records.push(record);
    current = record.cause;
  }

  for (const record of records) {
    const status = transientStatus(record);
    if (status !== null && (status === 408 || status === 429 || status >= 500)) return true;
  }

  const details = records
    .flatMap((record) => [record.code, record.name, record.message])
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  return /(?:ConnectTimeout|ReadTimeout|TimeoutError|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|EPIPE|socket hang up|fetch failed)/iu.test(
    details,
  );
}

async function retryImmRead<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= IMM_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= IMM_READ_MAX_ATTEMPTS || !isRetryableImmReadError(error)) throw error;
      const delay = IMM_READ_RETRY_DELAYS_MS[attempt - 1] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export class AliyunFaceProvider implements FaceProvider {
  readonly #client: InstanceType<typeof ImmClient.default>;
  readonly #projectName: string;
  readonly #clusterThreshold: number;
  readonly #minQuality: number;
  readonly #minSharpness: number;
  readonly #minFaceEdge: number;

  constructor(config: AppConfig) {
    const clientConfig = new $OpenApiUtil.Config({
      accessKeyId: required(config.ALIYUN_FACE_ACCESS_KEY_ID, "configuration"),
      accessKeySecret: required(config.ALIYUN_FACE_ACCESS_KEY_SECRET, "configuration"),
      regionId: config.ALIYUN_IMM_REGION,
      endpoint: `imm.${config.ALIYUN_IMM_REGION}.aliyuncs.com`,
    });
    this.#client = new ImmClientConstructor(clientConfig);
    this.#projectName = required(config.ALIYUN_IMM_PROJECT_NAME, "configuration");
    this.#clusterThreshold = config.FACE_SEARCH_CLUSTER_THRESHOLD;
    this.#minQuality = config.FACE_SEARCH_MIN_QUALITY;
    this.#minSharpness = config.FACE_SEARCH_MIN_SHARPNESS;
    this.#minFaceEdge = config.FACE_SEARCH_MIN_FACE_EDGE;
  }

  async createDataset(datasetName: string): Promise<void> {
    await this.#client.createDataset(
      new CreateDatasetRequest({
        projectName: this.#projectName,
        datasetName,
        templateId: "Official:FaceManagement",
      }),
    );
  }

  async datasetExists(datasetName: string): Promise<boolean> {
    try {
      await retryImmRead(() =>
        this.#client.getDataset(
          new GetDatasetRequest({ projectName: this.#projectName, datasetName }),
        ),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async indexMedia(input: { datasetName: string; mediaId: string; uri: string }): Promise<string> {
    const response = await this.#client.indexFileMeta(
      new IndexFileMetaRequest({
        projectName: this.#projectName,
        datasetName: input.datasetName,
        file: new InputFile({
          URI: input.uri,
          customId: input.mediaId,
          mediaType: "image",
        }),
      }),
    );
    return required(response.body?.eventId, "IndexFileMeta");
  }

  async mediaIndexed(datasetName: string, mediaId: string): Promise<boolean> {
    const response = await retryImmRead(() =>
      this.#client.simpleQuery(
        new SimpleQueryRequest({
          projectName: this.#projectName,
          datasetName,
          maxResults: 1,
          query: new SimpleQuery({ field: "CustomId", operation: "eq", value: mediaId }),
          withFields: ["CustomId"],
          withoutTotalHits: true,
        }),
      ),
    );
    return response.body?.files?.some((file) => file.customId === mediaId) ?? false;
  }

  async deleteMedia(datasetName: string, uris: readonly string[]): Promise<void> {
    for (let offset = 0; offset < uris.length; offset += 100) {
      await this.#client.batchDeleteFileMeta(
        new BatchDeleteFileMetaRequest({
          projectName: this.#projectName,
          datasetName,
          URIs: [...uris.slice(offset, offset + 100)],
        }),
      );
    }
  }

  async cluster(datasetName: string): Promise<string> {
    const response = await this.#client.createFigureClusteringTask(
      new CreateFigureClusteringTaskRequest({
        projectName: this.#projectName,
        datasetName,
      }),
    );
    return required(response.body?.taskId, "CreateFigureClusteringTask");
  }

  async taskStatus(taskId: string, taskType: "FaceClustering"): Promise<ProviderTaskStatus> {
    const response = await retryImmRead(() =>
      this.#client.getTask(
        new GetTaskRequest({ projectName: this.#projectName, taskId, taskType }),
      ),
    );
    if (response.body?.status === "Succeeded") return "succeeded";
    if (response.body?.status === "Failed") return "failed";
    return "running";
  }

  async validateReference(uri: string): Promise<ReferenceValidation> {
    const response = await retryImmRead(() =>
      this.#client.detectImageFaces(
        new DetectImageFacesRequest({ projectName: this.#projectName, sourceURI: uri }),
      ),
    );
    return classifyDetectedFaces(response.body?.faces ?? [], {
      quality: this.#minQuality,
      sharpness: this.#minSharpness,
      faceEdge: this.#minFaceEdge,
    });
  }

  async findSynchronousCandidates(datasetName: string, referenceUri: string): Promise<string[]> {
    const clusterResponse = await retryImmRead(() =>
      this.#client.searchImageFigureCluster(
        new SearchImageFigureClusterRequest({
          projectName: this.#projectName,
          datasetName,
          sourceURI: referenceUri,
        }),
      ),
    );
    const clusters = clusterResponse.body?.clusters ?? [];
    const clusterId = selectQualifiedCluster(clusters, this.#clusterThreshold);
    logClusterSimilarityResults(datasetName, this.#clusterThreshold, clusters);
    if (clusterId === null) return [];

    const mediaIds: string[] = [];
    let nextToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const response = await retryImmRead(() =>
        this.#client.simpleQuery(
          new SimpleQueryRequest({
            projectName: this.#projectName,
            datasetName,
            maxResults: 100,
            ...(nextToken === undefined ? {} : { nextToken }),
            query: new SimpleQuery({
              field: "Figures.FigureClusterId",
              operation: "eq",
              value: clusterId,
            }),
            withFields: ["CustomId"],
            withoutTotalHits: true,
          }),
        ),
      );
      for (const file of response.body?.files ?? []) {
        if (typeof file.customId === "string") mediaIds.push(file.customId);
      }
      const candidateToken = response.body?.nextToken || undefined;
      if (candidateToken !== undefined && seenTokens.has(candidateToken)) {
        throw new Error("SimpleQuery returned a repeated pagination token");
      }
      if (candidateToken !== undefined) seenTokens.add(candidateToken);
      nextToken = candidateToken;
    } while (nextToken !== undefined);
    return [...new Set(mediaIds)];
  }

  async startAsyncSearch(datasetName: string, referenceUri: string): Promise<string> {
    const response = await this.#client.createFacesSearchingTask(
      new CreateFacesSearchingTaskRequest({
        projectName: this.#projectName,
        datasetName,
        maxResult: 100,
        sources: [new CreateFacesSearchingTaskRequestSources({ URI: referenceUri })],
      }),
    );
    return required(response.body?.taskId, "CreateFacesSearchingTask");
  }

  async deleteDatasetContents(datasetName: string): Promise<void> {
    let previousBatch = "";
    let repeatedBatchCount = 0;
    for (;;) {
      const response = await retryImmRead(() =>
        this.#client.simpleQuery(
          new SimpleQueryRequest({
            projectName: this.#projectName,
            datasetName,
            maxResults: 100,
            withFields: ["URI"],
            withoutTotalHits: true,
          }),
        ),
      );
      const uris = (response.body?.files ?? []).flatMap((file) =>
        typeof file.URI === "string" ? [file.URI] : [],
      );
      if (uris.length === 0) return;
      const batch = [...uris].sort().join("\n");
      repeatedBatchCount = batch === previousBatch ? repeatedBatchCount + 1 : 0;
      if (repeatedBatchCount >= 2) {
        throw new Error("Dataset contents deletion was not confirmed");
      }
      previousBatch = batch;
      await this.deleteMedia(datasetName, uris);
    }
  }

  async deleteDataset(datasetName: string): Promise<void> {
    await this.#client.deleteDataset(
      new DeleteDatasetRequest({ projectName: this.#projectName, datasetName }),
    );
  }
}
