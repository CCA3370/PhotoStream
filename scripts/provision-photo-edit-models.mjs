import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

const repositoryRoot = resolve(import.meta.dirname, "..");
const assetVersion = "restoration-v1-20260918";
const destinationRoot = resolve(
  repositoryRoot,
  "apps/web/public/assets/models/photo-edit",
  assetVersion,
);
const cacheRoot = resolve(
  process.env.PHOTOSTREAM_MODEL_CACHE_DIR ??
    resolve(repositoryRoot, ".local-data/photo-edit-model-cache"),
);

const localAssets = [
  {
    file: "ort/ort-wasm-simd-threaded.jsep.mjs",
    source: resolve(
      repositoryRoot,
      "apps/web/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs",
    ),
    bytes: 46_595,
    sha256: "9a99acd12acc495184c9ea4d458ac9424f8180aacfbc7b8371ed64f9351e4a81",
  },
  {
    file: "ort/ort-wasm-simd-threaded.jsep.wasm",
    source: resolve(
      repositoryRoot,
      "apps/web/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm",
    ),
    bytes: 25_014_754,
    sha256: "2e0a3d0e3f6b7c13ecfaba38c13691fd19c9ed470e72f9d7d8416ca59ab6dbcd",
  },
];

const assets = [
  {
    file: "scunet_color_real_psnr.onnx",
    url: "https://huggingface.co/Heliosoph/scunet-onnx/resolve/75c7857c1ae254174fbeed18fa57fe4a1acb9ecf/scunet_color_real_psnr.onnx?download=true",
    bytes: 3_798_678,
    sha256: "231be201ab413dbc999d7951caa9844846b93a12a40a41e037d6b5888ed4e88c",
  },
  {
    file: "scunet_color_real_psnr.onnx.data",
    url: "https://huggingface.co/Heliosoph/scunet-onnx/resolve/75c7857c1ae254174fbeed18fa57fe4a1acb9ecf/scunet_color_real_psnr.onnx.data?download=true",
    bytes: 73_138_176,
    sha256: "98825ea1210b641c71e5f052f582c70c49fd44b35387ebe2c034268c17df3feb",
  },
  {
    file: "deblurring_nafnet_2025may.onnx",
    url: "https://huggingface.co/opencv/deblurring_nafnet/resolve/ea498688be1d1649d0965e0e16d275ecc7cc08ac/deblurring_nafnet_2025may.onnx?download=true",
    bytes: 91_736_251,
    sha256: "07263f416febecce10193dd648e950b22e397cf521eedab1a114ef77b2bc9587",
  },
];

async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function valid(path, asset) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size !== asset.bytes) return false;
    return (await digest(path)) === asset.sha256;
  } catch {
    return false;
  }
}

async function download(asset, cachePath) {
  const temp = `${cachePath}.tmp-${process.pid}`;
  await rm(temp, { force: true });
  const response = await fetch(asset.url, {
    redirect: "follow",
    headers: { "user-agent": "PhotoStream-model-provisioner/1" },
  });
  if (!response.ok || response.body === null) {
    throw new Error(`模型下载失败：${asset.file}（HTTP ${response.status}）`);
  }

  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(response.body, meter, createWriteStream(temp, { mode: 0o644 }));

  const sha256 = hash.digest("hex");
  if (bytes !== asset.bytes || sha256 !== asset.sha256) {
    await rm(temp, { force: true });
    throw new Error(
      `模型校验失败：${asset.file}，得到 ${bytes} bytes / ${sha256}`,
    );
  }
  await rename(temp, cachePath);
}

async function copyVerified(source, destination, asset) {
  await mkdir(dirname(destination), { recursive: true });
  const temp = `${destination}.tmp-${process.pid}`;
  await rm(temp, { force: true });
  await pipeline(createReadStream(source), createWriteStream(temp, { mode: 0o644 }));
  if (!(await valid(temp, asset))) {
    await rm(temp, { force: true });
    throw new Error(`复制后模型校验失败：${asset.file}`);
  }
  await rename(temp, destination);
}

await mkdir(cacheRoot, { recursive: true });
await mkdir(destinationRoot, { recursive: true });

for (const asset of localAssets) {
  if (!(await valid(asset.source, asset))) {
    throw new Error(
      `ONNX Runtime 本地资产与锁定版本不一致：${asset.file}。请重新执行 pnpm install --frozen-lockfile。`,
    );
  }
  const destination = resolve(destinationRoot, asset.file);
  if (!(await valid(destination, asset))) {
    await copyVerified(asset.source, destination, asset);
  }
}

for (const asset of assets) {
  const cachePath = resolve(cacheRoot, asset.file);
  if (!(await valid(cachePath, asset))) {
    await rm(cachePath, { force: true });
    process.stdout.write(`[PhotoStream] 下载修图模型 ${asset.file}...\n`);
    await download(asset, cachePath);
  } else {
    process.stdout.write(`[PhotoStream] 使用已校验模型缓存 ${asset.file}。\n`);
  }

  const destination = resolve(destinationRoot, asset.file);
  if (!(await valid(destination, asset))) {
    await copyVerified(cachePath, destination, asset);
  }
}

process.stdout.write(
  `[PhotoStream] 修图模型已准备：${destinationRoot}\n`,
);
