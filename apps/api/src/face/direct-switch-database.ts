import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";

function lifecycleSelection(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const selection = value as Record<string, unknown>;
  return selection.album === schema.albums && selection.index === schema.albumFaceIndexes;
}

function wrapLifecycleQuery(query: object): object {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === "then") {
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(target)
            .then((value) => {
              if (!Array.isArray(value)) return value;
              return value.map((row: unknown) => {
                if (typeof row !== "object" || row === null) return row;
                const typed = row as { album?: Record<string, unknown> };
                if (typed.album === undefined) return row;
                return {
                  ...typed,
                  album: { ...typed.album, access: "password", state: "live" },
                };
              });
            })
            .then(onFulfilled, onRejected);
      }
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const next = Reflect.apply(member, target, args) as unknown;
        return typeof next === "object" && next !== null ? wrapLifecycleQuery(next) : next;
      };
    },
  });
}

/**
 * Legacy face maintenance contains policy lifecycle rules that used to disable
 * face search for public/ended albums. The product now treats the per-album
 * switch as authoritative, so only that one legacy lifecycle read is projected
 * as an active password album. All other database reads/writes are untouched.
 */
export function directSwitchFaceDatabase(database: Database): Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "select") {
        const member = Reflect.get(target, property, receiver);
        return typeof member === "function" ? member.bind(target) : member;
      }
      return (selection?: unknown) => {
        const query = (target.select as (value?: unknown) => object)(selection);
        return lifecycleSelection(selection) ? wrapLifecycleQuery(query) : query;
      };
    },
  }) as Database;
}
