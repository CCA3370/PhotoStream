export interface CdnInvalidator {
  invalidate(paths: readonly string[]): Promise<void>;
}

export class LocalCdnInvalidator implements CdnInvalidator {
  async invalidate(_paths: readonly string[]): Promise<void> {
    // The local object data plane has no edge cache. Production supplies an OSS/CDN adapter.
  }
}
