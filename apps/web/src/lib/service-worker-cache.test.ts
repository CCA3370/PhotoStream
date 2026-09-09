import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("keeps media caches when a new shell worker activates", async () => {
  const handlers = new Map<
    string,
    (event: { waitUntil: (task: Promise<unknown>) => void }) => void
  >();
  const names = [
    "photostream-shell-v0",
    "photostream-shell-v1",
    "photostream-derived-images-v1",
    "photostream-original-images-v1",
    "photostream-internal-images-v1",
    "unrelated",
  ];
  const deleted: string[] = [];
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    self: {
      addEventListener: (
        name: string,
        handler: typeof handlers extends Map<string, infer T> ? T : never,
      ) => handlers.set(name, handler),
      clients: { claim: async () => undefined },
    },
    caches: {
      keys: async () => names,
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    },
  });
  let activation: Promise<unknown> = Promise.resolve();
  handlers.get("activate")?.({
    waitUntil: (task) => {
      activation = task;
    },
  });
  await activation;
  expect(deleted).toEqual(["photostream-shell-v0"]);
});
