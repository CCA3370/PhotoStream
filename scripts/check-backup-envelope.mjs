import { generateKeyPairSync } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decryptBackupFile, encryptBackupStream } from "./lib/backup-envelope.mjs";

const directory = await mkdtemp(join(tmpdir(), "photostream-backup-envelope-"));
try {
  const sourcePath = join(directory, "source.dump");
  const encryptedPath = join(directory, "backup.pstrbk");
  const restoredPath = join(directory, "restored.dump");
  const tamperedPath = join(directory, "tampered.pstrbk");
  const source = Buffer.concat([
    Buffer.from("deterministic backup fixture\n"),
    Buffer.alloc(256, 7),
  ]);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  await writeFile(sourcePath, source, { mode: 0o600 });
  const weakRecipient = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  let weakRejected = false;
  try {
    await encryptBackupStream({
      source: createReadStream(sourcePath),
      outputPath: join(directory, "weak.pstrbk"),
      publicKey: weakRecipient.publicKey,
    });
  } catch {
    weakRejected = true;
  }
  if (!weakRejected) throw new Error("Weak backup recipient key was accepted");
  await encryptBackupStream({
    source: createReadStream(sourcePath),
    outputPath: encryptedPath,
    publicKey,
  });
  await decryptBackupFile({ inputPath: encryptedPath, outputPath: restoredPath, privateKey });
  if (!(await readFile(restoredPath)).equals(source))
    throw new Error("Backup envelope round-trip failed");

  const tampered = await readFile(encryptedPath);
  tampered[tampered.byteLength - 1] ^= 1;
  await writeFile(tamperedPath, tampered, { mode: 0o600 });
  let rejected = false;
  try {
    await decryptBackupFile({
      inputPath: tamperedPath,
      outputPath: join(directory, "tampered.dump"),
      privateKey,
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Tampered backup was accepted");
  process.stdout.write("Backup envelope guard passed.\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
