import { readFile, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { encryptBackupStream } from "./lib/backup-envelope.mjs";
import { parseDatabaseUrl, processResult, spawnPostgresTool } from "./lib/postgres-tools.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function externalOutputPath(value) {
  if (value === undefined || !isAbsolute(value) || !value.endsWith(".pstrbk")) {
    throw new Error("--output must be an absolute .pstrbk path");
  }
  const output = resolve(value);
  const fromRepository = relative(process.cwd(), output);
  if (fromRepository !== "" && !fromRepository.startsWith("..")) {
    throw new Error("Backup output must be outside the repository");
  }
  return output;
}

const outputPath = externalOutputPath(argument("--output"));
const publicKeyFile = process.env.BACKUP_ENCRYPTION_PUBLIC_KEY_FILE;
if (publicKeyFile === undefined || !isAbsolute(publicKeyFile)) {
  throw new Error("BACKUP_ENCRYPTION_PUBLIC_KEY_FILE must be an absolute path");
}
const publicKey = await readFile(publicKeyFile, "utf8");
if (publicKey.includes("PRIVATE KEY")) {
  throw new Error("BACKUP_ENCRYPTION_PUBLIC_KEY_FILE must not contain a private key");
}
const connection = parseDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
const dump = spawnPostgresTool("pg_dump", connection, [
  "--format=custom",
  "--compress=6",
  "--no-owner",
  "--no-privileges",
]);
try {
  await Promise.all([
    encryptBackupStream({ source: dump.stdout, outputPath, publicKey }),
    processResult(dump, "pg_dump"),
  ]);
  process.stdout.write(`Encrypted database backup created: ${outputPath}\n`);
} catch (error) {
  dump.kill("SIGTERM");
  await unlink(outputPath).catch(() => undefined);
  throw error;
}
