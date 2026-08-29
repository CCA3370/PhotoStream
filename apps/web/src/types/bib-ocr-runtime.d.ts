interface PhotostreamBibOcrRunner {
  predict(input: unknown): Promise<
    readonly {
      readonly image: { readonly width: number; readonly height: number };
      readonly items: readonly {
        readonly poly: readonly [number, number][];
        readonly text: string;
        readonly score: number;
      }[];
    }[]
  >;
  dispose(): Promise<void>;
}

interface PhotostreamBibOcrRuntime {
  create(options: Record<string, unknown>): Promise<PhotostreamBibOcrRunner>;
}

declare var __photostreamBibOcrRuntime: PhotostreamBibOcrRuntime | undefined;
