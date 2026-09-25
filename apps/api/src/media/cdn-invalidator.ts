import CdnClient, { RefreshObjectCachesRequest } from "@alicloud/cdn20180510/dist/client.js";
import { $OpenApiUtil } from "@alicloud/openapi-core";

import { ALIYUN_REGION } from "../config.js";

export interface CdnInvalidator {
  invalidate(paths: readonly string[]): Promise<void>;
  invalidateDirectory?(path: string): Promise<void>;
}

export class LocalCdnInvalidator implements CdnInvalidator {
  async invalidate(_paths: readonly string[]): Promise<void> {
    // The local object data plane has no edge cache. Production supplies an OSS/CDN adapter.
  }
}

const CdnClientConstructor =
  (CdnClient as unknown as { default?: typeof CdnClient.default }).default ??
  (CdnClient as unknown as typeof CdnClient.default);

export class AliyunCdnInvalidator implements CdnInvalidator {
  readonly #client: InstanceType<typeof CdnClientConstructor>;
  readonly #mediaBaseUrl: URL;

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
    this.#mediaBaseUrl = new URL(options.mediaBaseUrl);
  }

  async invalidate(paths: readonly string[]): Promise<void> {
    for (let offset = 0; offset < paths.length; offset += 1_000) {
      const urls = paths.slice(offset, offset + 1_000).map((path) => {
        const url = new URL(this.#mediaBaseUrl);
        url.pathname = path.startsWith("/") ? path : `/${path}`;
        url.search = "";
        url.hash = "";
        return url.href;
      });
      if (urls.length === 0) continue;
      await this.#client.refreshObjectCaches(
        new RefreshObjectCachesRequest({
          force: true,
          objectPath: urls.join("\n"),
          objectType: "File",
        }),
      );
    }
  }

  async invalidateDirectory(path: string): Promise<void> {
    const url = new URL(this.#mediaBaseUrl);
    const normalized = path.startsWith("/") ? path : `/${path}`;
    url.pathname = normalized.endsWith("/") ? normalized : `${normalized}/`;
    url.search = "";
    url.hash = "";
    await this.#client.refreshObjectCaches(
      new RefreshObjectCachesRequest({
        force: true,
        objectPath: url.href,
        objectType: "Directory",
      }),
    );
  }
}
