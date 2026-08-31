import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import { decryptBackupFile } from "./lib/backup-envelope.mjs";
import {
  parseDatabaseUrl,
  processResult,
  queryScalar,
  spawnPostgresTool,
} from "./lib/postgres-tools.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function outsideRepository(value, label) {
  const path = resolve(value);
  const fromRepository = relative(process.cwd(), path);
  if (fromRepository === "" || !fromRepository.startsWith("..")) {
    throw new Error(`${label} must be outside the repository`);
  }
  return path;
}

const inputArgument = argument("--input");
if (
  inputArgument === undefined ||
  !isAbsolute(inputArgument) ||
  !inputArgument.endsWith(".pstrbk")
) {
  throw new Error("--input must be an absolute .pstrbk path");
}
const inputPath = outsideRepository(inputArgument, "Encrypted backup");
const privateKeyFile = process.env.BACKUP_DECRYPTION_PRIVATE_KEY_FILE;
if (privateKeyFile === undefined || !isAbsolute(privateKeyFile)) {
  throw new Error("BACKUP_DECRYPTION_PRIVATE_KEY_FILE must be an absolute path");
}
const privateKeyPath = outsideRepository(privateKeyFile, "Backup private key");
const connection = parseDatabaseUrl(process.env.RESTORE_DATABASE_URL, "RESTORE_DATABASE_URL");
if (!/^photostream_restore_[A-Za-z0-9_]+$/u.test(connection.database)) {
  throw new Error("Restore target must be an isolated database named photostream_restore_<name>");
}
const existingTables = await queryScalar(
  connection,
  "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema') and table_type = 'BASE TABLE'",
);
if (existingTables !== "0") throw new Error("Restore target is not empty");

const privateKey = await readFile(privateKeyPath, "utf8");
if (!privateKey.includes("PRIVATE KEY")) {
  throw new Error("BACKUP_DECRYPTION_PRIVATE_KEY_FILE must contain a private key");
}
const temporaryDirectory = await mkdtemp(join(tmpdir(), "photostream-restore-"));
const plaintextPath = join(temporaryDirectory, `${basename(inputPath)}.dump`);
try {
  await decryptBackupFile({ inputPath, outputPath: plaintextPath, privateKey });

  const list = spawnPostgresTool("pg_restore", connection, ["--list"], process.env, {
    connect: false,
  });
  list.stdout.resume();
  await Promise.all([
    pipeline(createReadStream(plaintextPath), list.stdin),
    processResult(list, "pg_restore archive validation"),
  ]);

  const restore = spawnPostgresTool("pg_restore", connection, [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-privileges",
  ]);
  restore.stdout.resume();
  await Promise.all([
    pipeline(createReadStream(plaintextPath), restore.stdin),
    processResult(restore, "pg_restore"),
  ]);

  const restoredTables = Number(
    await queryScalar(
      connection,
      "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    ),
  );
  const migrations = Number(
    await queryScalar(connection, "select count(*) from drizzle.__drizzle_migrations"),
  );
  if (
    !Number.isSafeInteger(restoredTables) ||
    restoredTables < 1 ||
    !Number.isSafeInteger(migrations) ||
    migrations < 1
  ) {
    throw new Error("Restored database failed structural verification");
  }
  process.stdout.write(
    `Isolated restore completed: ${connection.database} (${restoredTables} public tables, ${migrations} migrations)\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
