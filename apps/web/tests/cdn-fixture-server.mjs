// Local synthetic data plane for browser regression, not a production API.
// Run with API_INTERNAL_URL=http://127.0.0.1:3011 and MEDIA_BASE_URL=http://127.0.0.1:3011.
import { createServer } from "node:http";

const origin = "http://127.0.0.1:3011";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=",
  "base64",
);
const counts = {};
const ids = [1, 2, 3].map((i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const urlFor = (id, kind) => `${origin}/objects/${id}/${kind}.png?auth_key=fixture-${Date.now()}`;
const items = () =>
  ids.map((id, i) => ({
    id,
    width: 1920,
    height: 1280,
    publishSequence: i + 1,
    publishedAt: "2026-09-09T00:00:00.000Z",
    variants: ["photo_480", "photo_960", "photo_1920"].map((kind) => ({
      kind,
      url: urlFor(id, kind),
      width: 1920,
      height: 1280,
      bytes: png.length,
      contentType: "image/png",
    })),
    downloads: { preview: true, original: true, originalBytes: png.length },
  }));
const server = createServer((request, response) => {
  const url = new URL(request.url, origin);
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname.startsWith("/objects/")) {
    counts[url.pathname] = (counts[url.pathname] ?? 0) + 1;
    response.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length });
    response.end(png);
    return;
  }
  response.setHeader("Content-Type", "application/json");
  let data = {};
  if (url.pathname === "/__counts") data = counts;
  else if (url.pathname.endsWith("/face-state"))
    data = { enabled: false, noticeVersion: "fixture", indexState: "disabled" };
  else if (url.pathname.endsWith("/featured")) data = { mediaIds: ids };
  else if (url.pathname.endsWith("/likes"))
    data = { items: ids.map((mediaId) => ({ mediaId, liked: false, count: 0 })) };
  else if (url.pathname.includes("/downloads/") || url.pathname.includes("/originals/")) {
    const match = url.pathname.match(/(?:downloads|originals)\/([^/]+)\/(preview|original|view)$/);
    if (!match) {
      response.writeHead(400);
      response.end("{}");
      return;
    }
    counts[match[2] === "view" ? "viewAuthorizations" : "downloadAuthorizations"] =
      (counts[match[2] === "view" ? "viewAuthorizations" : "downloadAuthorizations"] ?? 0) + 1;
    data = {
      url: urlFor(match[1], match[2] === "preview" ? "photo_1920" : "photo_original"),
      filename: "fixture.png",
      bytes: png.length,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    };
  } else if (url.pathname.endsWith("/media"))
    data = { items: items(), nextCursor: null, eventCursor: 0 };
  else if (/\/albums\/[^/]+$/.test(url.pathname))
    data = {
      title: "CDN synthetic regression",
      description: "Three synthetic images",
      state: "ended",
      accessRequired: false,
      categories: [],
      bibSearchEnabled: false,
      bibAttributeFilterEnabled: false,
      bibAttributeOptions: [],
      bibAttributePairs: [],
      bibNumberLengths: [],
    };
  response.end(JSON.stringify(data));
});
server.listen(3011, "127.0.0.1", () => console.log("CDN fixture listening on 3011"));
