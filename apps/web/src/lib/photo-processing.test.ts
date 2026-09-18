import { afterEach, describe, expect, it, vi } from "vitest";
import { processPhotoInWorkerStreaming } from "./photo-processing";
import { PHOTO_WORKER_PROTOCOL_VERSION } from "./photo-worker-protocol";

type MessageListener = (event: MessageEvent<unknown>) => void;
type ErrorListener = (event: Event) => void;

class FakeWorker {
  static responder: ((request: unknown, worker: FakeWorker) => void) | null = null;
  static latest: FakeWorker | null = null;

  readonly messageListeners = new Set<MessageListener>();
  readonly errorListeners = new Set<ErrorListener>();
  terminated = false;

  constructor() {
    FakeWorker.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== "function") return;
    if (type === "message") this.messageListeners.add(listener as MessageListener);
    if (type === "error") this.errorListeners.add(listener as ErrorListener);
  }

  postMessage(request: unknown): void {
    FakeWorker.responder?.(request, this);
  }

  emitMessage(data: unknown): void {
    const event = { data } as MessageEvent<unknown>;
    for (const listener of this.messageListeners) listener(event);
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  FakeWorker.responder = null;
  FakeWorker.latest = null;
  vi.unstubAllGlobals();
});

describe("photo worker protocol", () => {
  it("rejects a legacy worker response instead of accepting the old protocol", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.responder = (request, worker) => {
      const id = (request as { id: string }).id;
      queueMicrotask(() => {
        worker.emitMessage({
          id,
          ok: true,
          photo: {
            width: 64,
            height: 48,
            originalFormat: "jpeg",
            originalContentType: "image/jpeg",
            capturedAt: null,
            variants: [],
          },
        });
      });
    };

    const pending = processPhotoInWorkerStreaming(
      new File(["legacy"], "legacy.jpg", { type: "image/jpeg" }),
    );

    await expect(pending).rejects.toThrow("照片处理组件版本已过期");
    expect(FakeWorker.latest?.terminated).toBe(true);
  });

  it("requires protocol version 2 and completes only the current streaming protocol", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.responder = (request, worker) => {
      const message = request as { id: string; protocolVersion: number };
      expect(message.protocolVersion).toBe(PHOTO_WORKER_PROTOCOL_VERSION);
      queueMicrotask(() => {
        worker.emitMessage({
          id: message.id,
          protocolVersion: PHOTO_WORKER_PROTOCOL_VERSION,
          type: "metadata",
          metadata: {
            width: 64,
            height: 48,
            originalFormat: "jpeg",
            originalContentType: "image/jpeg",
            capturedAt: null,
          },
        });
        worker.emitMessage({
          id: message.id,
          protocolVersion: PHOTO_WORKER_PROTOCOL_VERSION,
          type: "complete",
        });
      });
    };

    await expect(
      processPhotoInWorkerStreaming(new File(["current"], "current.jpg", { type: "image/jpeg" })),
    ).resolves.toMatchObject({
      width: 64,
      height: 48,
      originalFormat: "jpeg",
      originalContentType: "image/jpeg",
      variants: [],
    });
    expect(FakeWorker.latest?.terminated).toBe(true);
  });
});
