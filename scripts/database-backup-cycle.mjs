import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  relative,
  resolve,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { backupFileName, planBackupRetention } from "./lib/backup-retention.mjs";
import { backupOssEndpoint, uploadPrivateBackup } from "./lib/oss-backup-upload.mjs";
import { parseDatabaseUrl, queryScalar } from "./lib/postgres-tools.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const backupScript = fileURLToPath(new URL("./database-backup.mjs", import.meta.url));
const lockStaleMilliseconds = 6 * 60 * 60 * 1_000;
const minimumFreeBytes = 512 * 1024 * 1024;
const outputLimit = 8 * 1024;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function backupDirectory(value) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error("Backup directory must be an absolute path");
  }
  const directory = resolve(value);
  const fromRepository = relative(repositoryRoot, directory);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error("Backup directory must be outside the repository");
  }
  return directory;
}

async function acquireLock(directory) {
  const lockPath = join(directory, ".photostream-backup.lock");
  const create = () => open(lockPath, "wx", 0o600);
  try {
    const handle = await create();
    await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
    return { handle, lockPath };
  } catch (error) {
    if (!(error instanceof Error) || !Object.hasOwn(error, "code") || error.code !== "EEXIST") throw error;
    const lock = await stat(lockPath).catch(() => null);
    if (lock === null || Date.now() - lock.mtimeMs <= lockStaleMilliseconds) {
      throw new Error("Another database backup cycle appears to be running");
    }
    await unlink(lockPath);
    const handle = await create();
    await handle.writeFile(`${process.pid} ${new Date().toISOString()} stale-lock-recovered\n`);
    return { handle, lockPath };
  }
}

async function runEncryptedBackup(outputPath) {
  const child = spawn(process.execPath, [backupScript, "--output", outputPath], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (stdout.length < outputLimit) stdout += chunk.slice(0, outputLimit - stdout.length);
  });
  child.stderr.on("data", (chunk) => {
    if (stderr.length < outputLimit) stderr += chunk.slice(0, outputLimit - stderr.length);
  });
  const exit = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  if (exit.code !== 0) {
    throw new Error(
      `Encrypted backup failed (${exit.signal === null ? `exit ${String(exit.code)}` : `signal ${exit.signal}`})`,
      { cause: stderr.trim() === "" ? undefined : new Error("pg_dump emitted a diagnostic") },
    );
  }
  return stdout.trim();
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function migrationCount() {
  try {
    const connection = parseDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
    const value = await queryScalar(
      connection,
      "select count(*) from drizzle.__drizzle_migrations",
      process.env,
    );
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function uploadConfiguration() {
  const driver = process.env.BACKUP_UPLOAD_DRIVER ?? "none";
  if (driver === "none") return null;
  if (driver !== "aliyun") throw new Error("BACKUP_UPLOAD_DRIVER must be none or aliyun");
  const bucket = process.env.ALIYUN_OSS_BACKUP_BUCKET;
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  if (bucket === undefined || accessKeyId === undefined || accessKeySecret === undefined) {
    throw new Error("Aliyun backup upload requires bucket and access key credentials");
  }
  const endpoint = process.env.ALIYUN_OSS_ENDPOINT ?? backupOssEndpoint;
  const prefix = (process.env.BACKUP_OSS_PREFIX ?? "photostream/database").replace(/^\/+|\/+$/gu, "");
  if (!/^[A-Za-z0-9._/-]{1,120}$/u.test(prefix) || prefix.includes("..")) {
    throw new Error("BACKUP_OSS_PREFIX is invalid");
  }
  return { bucket, accessKeyId, accessKeySecret, endpoint, prefix };
}

async function uploadArtifacts(configuration, date, backupPath, manifestPath, backupSha) {
  if (configuration === null) return false;
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const directory = `${configuration.prefix}/${year}/${month}`;
  await uploadPrivateBackup({
    ...configuration,
    filePath: backupPath,
    objectKey: `${directory}/${basename(backupPath)}`,
    sha256: backupSha,
  });
  const manifestSha = await sha256File(manifestPath);
  await uploadPrivateBackup({
    ...configuration,
    filePath: manifestPath,
    objectKey: `${directory}/${basename(manifestPath)}`,
    sha256: manifestSha,
    contentType: "application/json",
  });
  return true;
}

async function pruneLocalBackups(directory) {
  const entries = await readdir(directory);
  const plan = planBackupRetention(entries);
  for (const name of plan.remove) {
    await unlink(join(directory, name));
    await unlink(join(directory, `${name}.manifest.json`)).catch(() => undefined);
  }
  return plan.remove.length;
}

const directory = backupDirectory(argument("--directory") ?? process.env.BACKUP_DIRECTORY);
await mkdir(directory, { recursive: true, mode: 0o700 });
const filesystem = await statfs(directory);
const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
if (Number.isFinite(availableBytes) && availableBytes < minimumFreeBytes) {
  throw new Error("Backup directory has less than 512 MiB available");
}
const lock = await acquireLock(directory);
let outputPath;
try {
  const createdAt = new Date();
  const name = backupFileName(createdAt);
  outputPath = join(directory, name);
  await runEncryptedBackup(outputPath);
  const backupStat = await stat(outputPath);
  const backupSha = await sha256File(outputPath);
  const manifestPath = `${outputPath}.manifest.json`;
  const manifest = {
    version: 1,
    backup: name,
    createdAt: createdAt.toISOString(),
    bytes: backupStat.size,
    sha256: backupSha,
    migrationCount: await migrationCount(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  const upload = uploadConfiguration();
  const uploaded = await uploadArtifacts(upload, createdAt, outputPath, manifestPath, backupSha);
  const removed = await pruneLocalBackups(directory);
  process.stdout.write(
    `${JSON.stringify({ backup: name, bytes: backupStat.size, sha256: backupSha, uploaded, removed })}\n`,
  );
} catch (error) {
  if (outputPath !== undefined) {
    const manifestPath = `${outputPath}.manifest.json`;
    const backupExists = await readFile(outputPath).then(() => true).catch(() => false);
    if (!backupExists) await unlink(manifestPath).catch(() => undefined);
  }
  throw error;
} finally {
  await lock.handle.close().catch(() => undefined);
  await unlink(lock.lockPath).catch(() => undefined);
}
