import CdnClient, * as CdnSdk from "@alicloud/cdn20180510/dist/client.js";
import { $OpenApiUtil } from "@alicloud/openapi-core";

import { ALIYUN_REGION } from "../config.js";

const threeDaysMs = 3 * 24 * 60 * 60 * 1_000;

type RecordValue = Record<string, unknown>;
type RequestConstructor = new (values: RecordValue) => unknown;
type CdnOperation = (request: unknown) => Promise<unknown>;

export interface CdnMetricsPoint {
  readonly at: string;
  readonly trafficBytes: number;
  readonly bandwidthBps: number;
  readonly originTrafficBytes: number;
  readonly byteHitRate: number | null;
  readonly requestHitRate: number | null;
  readonly http2xx: number;
  readonly http3xx: number;
  readonly http4xx: number;
  readonly http5xx: number;
}

export interface CdnMetricsSnapshot {
  readonly status: "ok" | "partial" | "unavailable" | "error";
  readonly domain: string | null;
  readonly intervalSeconds: number;
  readonly dataDelaySeconds: number;
  readonly trafficBytes: number;
  readonly originTrafficBytes: number;
  readonly peakBandwidthBps: number;
  readonly averageByteHitRate: number | null;
  readonly averageRequestHitRate: number | null;
  readonly requests: number;
  readonly errorRequests: number;
  readonly points: readonly CdnMetricsPoint[];
  readonly message: string | null;
}

export interface CdnMetricsProvider {
  query(options: { readonly from: Date; readonly to: Date }): Promise<CdnMetricsSnapshot>;
}

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null ? (value as RecordValue) : null;
}

function valueAt(source: unknown, ...keys: readonly string[]): unknown {
  const current = record(source);
  if (current === null) return undefined;
  for (const key of keys) {
    if (key in current) return current[key];
  }
  return undefined;
}

function listAt(source: unknown, ...keys: readonly string[]): readonly unknown[] {
  const value = valueAt(source, ...keys);
  return Array.isArray(value) ? value : [];
}

function bodyOf(response: unknown): unknown {
  return valueAt(response, "body", "Body") ?? response;
}

function numeric(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function metricSeries(response: unknown, containerKeys: readonly string[]) {
  const body = bodyOf(response);
  let container: unknown = body;
  for (const key of containerKeys) container = valueAt(container, key, key[0]?.toUpperCase() + key.slice(1));
  return listAt(container, "dataModule", "DataModule")
    .map((item) => ({
      at: timestamp(valueAt(item, "timeStamp", "TimeStamp")),
      value: numeric(valueAt(item, "value", "Value")),
    }))
    .filter((item): item is { at: string; value: number } => item.at !== null && item.value !== null);
}

function httpSeries(response: unknown) {
  const body = bodyOf(response);
  const httpCodeData = valueAt(body, "httpCodeData", "HttpCodeData");
  return listAt(httpCodeData, "usageData", "UsageData")
    .map((item) => {
      const at = timestamp(valueAt(item, "timeStamp", "TimeStamp"));
      const value = valueAt(item, "value", "Value");
      const counts = { http2xx: 0, http3xx: 0, http4xx: 0, http5xx: 0 };
      for (const code of listAt(value, "codeProportionData", "CodeProportionData")) {
        const statusCode = String(valueAt(code, "code", "Code") ?? "");
        const count = numeric(valueAt(code, "count", "Count")) ?? 0;
        if (statusCode.startsWith("2")) counts.http2xx += count;
        else if (statusCode.startsWith("3")) counts.http3xx += count;
        else if (statusCode.startsWith("4")) counts.http4xx += count;
        else if (statusCode.startsWith("5")) counts.http5xx += count;
      }
      return { at, ...counts };
    })
    .filter((item): item is { at: string; http2xx: number; http3xx: number; http4xx: number; http5xx: number } => item.at !== null);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aliyunTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

const CdnClientConstructor =
  (CdnClient as unknown as { default?: typeof CdnClient.default }).default ??
  (CdnClient as unknown as typeof CdnClient.default);

export class UnavailableCdnMetricsProvider implements CdnMetricsProvider {
  async query(): Promise<CdnMetricsSnapshot> {
    return {
      status: "unavailable",
      domain: null,
      intervalSeconds: 0,
      dataDelaySeconds: 0,
      trafficBytes: 0,
      originTrafficBytes: 0,
      peakBandwidthBps: 0,
      averageByteHitRate: null,
      averageRequestHitRate: null,
      requests: 0,
      errorRequests: 0,
      points: [],
      message: "当前环境未启用阿里云 CDN 监控",
    };
  }
}

export class AliyunCdnMetricsProvider implements CdnMetricsProvider {
  readonly #client: InstanceType<typeof CdnClientConstructor>;
  readonly #domain: string;

  constructor(options: {
    readonly accessKeyId: string;
    readonly accessKeySecret: string;
    readonly mediaBaseUrl: string;
  }) {
    this.#client = new CdnClientConstructor(
      new $OpenApiUtil.Config({
        accessKeyId: options.accessKeyId,
        accessKeySecret: options.accessKeySecret,
        endpoint: "cdn.aliyuncs.com",
        regionId: ALIYUN_REGION,
      }),
    );
    this.#domain = new URL(options.mediaBaseUrl).hostname;
  }

  #request(name: string, values: RecordValue): unknown {
    const constructor = (CdnSdk as unknown as RecordValue)[name];
    if (typeof constructor !== "function") throw new Error(`CDN SDK request unavailable: ${name}`);
    return new (constructor as RequestConstructor)(values);
  }

  async #call(operation: string, requestName: string, values: RecordValue): Promise<unknown> {
    const method = (this.#client as unknown as RecordValue)[operation];
    if (typeof method !== "function") throw new Error(`CDN SDK operation unavailable: ${operation}`);
    return (method as CdnOperation).call(this.#client, this.#request(requestName, values));
  }

  async query(options: { readonly from: Date; readonly to: Date }): Promise<CdnMetricsSnapshot> {
    const durationMs = options.to.getTime() - options.from.getTime();
    const intervalSeconds = durationMs <= threeDaysMs ? 300 : 3600;
    const dataDelaySeconds = intervalSeconds === 300 ? 15 * 60 : 4 * 60 * 60;
    const values = {
      domainName: this.#domain,
      startTime: aliyunTime(options.from),
      endTime: aliyunTime(options.to),
      interval: String(intervalSeconds),
    };

    const results = await Promise.allSettled([
      this.#call("describeDomainTrafficData", "DescribeDomainTrafficDataRequest", values),
      this.#call("describeDomainBpsData", "DescribeDomainBpsDataRequest", values),
      this.#call("describeDomainSrcTrafficData", "DescribeDomainSrcTrafficDataRequest", values),
      this.#call("describeDomainHitRateData", "DescribeDomainHitRateDataRequest", values),
      this.#call("describeDomainReqHitRateData", "DescribeDomainReqHitRateDataRequest", values),
      this.#call("describeDomainHttpCodeData", "DescribeDomainHttpCodeDataRequest", values),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled").length;
    if (fulfilled === 0) {
      return {
        status: "error",
        domain: this.#domain,
        intervalSeconds,
        dataDelaySeconds,
        trafficBytes: 0,
        originTrafficBytes: 0,
        peakBandwidthBps: 0,
        averageByteHitRate: null,
        averageRequestHitRate: null,
        requests: 0,
        errorRequests: 0,
        points: [],
        message: "无法读取阿里云 CDN 监控数据",
      };
    }

    const response = (index: number): unknown => {
      const result = results[index];
      return result?.status === "fulfilled" ? result.value : undefined;
    };
    const traffic = metricSeries(response(0), ["trafficDataPerInterval"]);
    const bandwidth = metricSeries(response(1), ["bpsDataPerInterval"]);
    const originTraffic = metricSeries(response(2), ["srcTrafficDataPerInterval"]);
    const byteHitRate = metricSeries(response(3), ["hitRateInterval"]);
    const requestHitRate = metricSeries(response(4), ["reqHitRateInterval"]);
    const http = httpSeries(response(5));

    const points = new Map<string, CdnMetricsPoint>();
    const ensure = (at: string): CdnMetricsPoint => {
      const existing = points.get(at);
      if (existing !== undefined) return existing;
      const created: CdnMetricsPoint = {
        at,
        trafficBytes: 0,
        bandwidthBps: 0,
        originTrafficBytes: 0,
        byteHitRate: null,
        requestHitRate: null,
        http2xx: 0,
        http3xx: 0,
        http4xx: 0,
        http5xx: 0,
      };
      points.set(at, created);
      return created;
    };
    const replace = (at: string, valuesToSet: Partial<CdnMetricsPoint>) => {
      points.set(at, { ...ensure(at), ...valuesToSet, at });
    };
    for (const item of traffic) replace(item.at, { trafficBytes: item.value });
    for (const item of bandwidth) replace(item.at, { bandwidthBps: item.value });
    for (const item of originTraffic) replace(item.at, { originTrafficBytes: item.value });
    for (const item of byteHitRate) replace(item.at, { byteHitRate: item.value });
    for (const item of requestHitRate) replace(item.at, { requestHitRate: item.value });
    for (const item of http) replace(item.at, item);

    const sorted = [...points.values()].sort((left, right) => left.at.localeCompare(right.at));
    const requests = sorted.reduce(
      (sum, item) => sum + item.http2xx + item.http3xx + item.http4xx + item.http5xx,
      0,
    );
    const errorRequests = sorted.reduce((sum, item) => sum + item.http4xx + item.http5xx, 0);

    return {
      status: fulfilled === results.length ? "ok" : "partial",
      domain: this.#domain,
      intervalSeconds,
      dataDelaySeconds,
      trafficBytes: traffic.reduce((sum, item) => sum + item.value, 0),
      originTrafficBytes: originTraffic.reduce((sum, item) => sum + item.value, 0),
      peakBandwidthBps: bandwidth.reduce((max, item) => Math.max(max, item.value), 0),
      averageByteHitRate: average(byteHitRate.map((item) => item.value)),
      averageRequestHitRate: average(requestHitRate.map((item) => item.value)),
      requests,
      errorRequests,
      points: sorted,
      message: fulfilled === results.length ? null : "部分 CDN 监控指标暂不可用",
    };
  }
}
