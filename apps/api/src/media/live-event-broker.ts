import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";

const channel = "photostream_live_event";

export class LiveEventBroker {
  readonly #emitter = new EventEmitter();
  #client: PoolClient | null = null;

  constructor() {
    this.#emitter.setMaxListeners(0);
  }

  async start(pool: Pool): Promise<void> {
    if (this.#client !== null) return;
    const client = await pool.connect();
    client.on("notification", (message) => {
      if (message.channel === channel && message.payload !== undefined) {
        this.#emitter.emit(message.payload);
      }
    });
    client.on("error", () => {
      this.#emitter.emit("broker-error");
    });
    await client.query(`LISTEN ${channel}`);
    this.#client = client;
  }

  async close(): Promise<void> {
    if (this.#client === null) return;
    await this.#client.query(`UNLISTEN ${channel}`).catch(() => undefined);
    this.#client.release();
    this.#client = null;
    this.#emitter.removeAllListeners();
  }

  subscribe(albumId: string, listener: () => void): () => void {
    this.#emitter.on(albumId, listener);
    return () => this.#emitter.off(albumId, listener);
  }
}

export const liveEventChannel = channel;
