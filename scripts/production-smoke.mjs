const rawBaseUrl = process.env.PHOTOSTREAM_SMOKE_BASE_URL?.trim();
const rawMediaUrl = process.env.PHOTOSTREAM_SMOKE_MEDIA_URL?.trim();

if (!rawBaseUrl) {
  process.stderr.write("PHOTOSTREAM_SMOKE_BASE_URL is required\n");
  process.exit(2);
}

const baseUrl = new URL(rawBaseUrl);
if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
  process.stderr.write("Smoke target must use HTTPS outside localhost\n");
  process.exit(2);
}

const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(label, work) {
  try {
    await work();
    process.stdout.write(`PASS ${label}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${label}: ${message}`);
    process.stdout.write(`FAIL ${label}: ${message}\n`);
  }
}

async function fetchPath(path, init = {}) {
  return fetch(new URL(path, baseUrl), {
    redirect: "follow",
    cache: "no-store",
    ...init,
  });
}

await check("liveness", async () => {
  const response = await fetchPath("/api/v1/health/live");
  assert(response.status === 200, `HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.status === "ok", "unexpected liveness payload");
});

await check("readiness", async () => {
  const response = await fetchPath("/api/v1/health/ready");
  assert(response.status === 200, `HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.status === "ok", "unexpected readiness payload");
});

await check("homepage and security headers", async () => {
  const response = await fetchPath("/");
  assert(response.ok, `HTTP ${response.status}`);
  assert(
    response.headers.get("strict-transport-security")?.includes("max-age=") === true,
    "missing HSTS",
  );
  assert(response.headers.get("x-content-type-options") === "nosniff", "missing nosniff");
  assert(response.headers.get("x-frame-options") === "DENY", "missing frame deny");
  assert(response.headers.has("referrer-policy"), "missing referrer policy");
  assert(response.headers.has("permissions-policy"), "missing permissions policy");
  assert(response.headers.has("content-security-policy"), "missing CSP");
});

await check("service worker cache policy", async () => {
  const response = await fetchPath("/sw.js");
  assert(response.ok, `HTTP ${response.status}`);
  const cacheControl = response.headers.get("cache-control") ?? "";
  assert(cacheControl.includes("no-cache"), "sw.js must be revalidated");
  assert(cacheControl.includes("no-store"), "sw.js must not be persistently cached");
});

if (rawMediaUrl) {
  await check("CDN media CORS and cache headers", async () => {
    const mediaUrl = new URL(rawMediaUrl);
    const response = await fetch(mediaUrl, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
      headers: { Origin: baseUrl.origin },
    });
    assert(response.ok, `HTTP ${response.status}`);
    const allowOrigin = response.headers.get("access-control-allow-origin");
    assert(
      allowOrigin === "*" || allowOrigin === baseUrl.origin,
      "media response does not allow the application origin",
    );
    assert(response.headers.has("cache-control"), "media response has no cache-control header");
  });
} else {
  process.stdout.write("SKIP CDN media check: PHOTOSTREAM_SMOKE_MEDIA_URL is not set\n");
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} smoke check(s) failed.\n`);
  process.exit(1);
}

process.stdout.write("\nProduction read-only smoke checks passed.\n");
