import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("PSTRBK01", "ascii");
const ivBytes = 12;
const tagBytes = 16;
const lengthBytes = 2;

class CipherTransform extends Transform {
  #cipher;

  constructor(cipher) {
    super();
    this.#cipher = cipher;
  }

  _transform(chunk, _encoding, callback) {
    try {
      callback(null, this.#cipher.update(chunk));
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    try {
      this.push(this.#cipher.final());
      this.push(this.#cipher.getAuthTag());
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

function envelopeHeader(publicKey) {
  const recipient = createPublicKey(publicKey);
  if (
    recipient.asymmetricKeyType !== "rsa" ||
    (recipient.asymmetricKeyDetails?.modulusLength ?? 0) < 3_072
  ) {
    throw new Error("Backup recipient must be an RSA key of at least 3072 bits");
  }
  const dataKey = randomBytes(32);
  const iv = randomBytes(ivBytes);
  const wrappedKey = publicEncrypt({ key: recipient, oaepHash: "sha256" }, dataKey);
  if (wrappedKey.byteLength > 65_535) throw new Error("Backup recipient key is too large");
  const wrappedLength = Buffer.alloc(lengthBytes);
  wrappedLength.writeUInt16BE(wrappedKey.byteLength);
  return {
    dataKey,
    iv,
    header: Buffer.concat([magic, wrappedLength, iv, wrappedKey]),
  };
}

export async function encryptBackupStream({ source, outputPath, publicKey }) {
  const { dataKey, iv, header } = envelopeHeader(publicKey);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  cipher.setAAD(header);
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  output.write(header);
  await pipeline(source, new CipherTransform(cipher), output);
}

async function readExactly(handle, buffer, position) {
  const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
  if (bytesRead !== buffer.byteLength) throw new Error("Encrypted backup is truncated");
}

export async function decryptBackupFile({ inputPath, outputPath, privateKey }) {
  const recipient = createPrivateKey(privateKey);
  if (
    recipient.asymmetricKeyType !== "rsa" ||
    (recipient.asymmetricKeyDetails?.modulusLength ?? 0) < 3_072
  ) {
    throw new Error("Backup recipient must be an RSA key of at least 3072 bits");
  }
  const file = await stat(inputPath);
  const fixedHeaderBytes = magic.byteLength + lengthBytes + ivBytes;
  if (file.size <= fixedHeaderBytes + tagBytes) throw new Error("Encrypted backup is truncated");
  const handle = await open(inputPath, "r");
  try {
    const fixedHeader = Buffer.alloc(fixedHeaderBytes);
    await readExactly(handle, fixedHeader, 0);
    if (!fixedHeader.subarray(0, magic.byteLength).equals(magic)) {
      throw new Error("Encrypted backup format is invalid");
    }
    const wrappedKeyBytes = fixedHeader.readUInt16BE(magic.byteLength);
    if (wrappedKeyBytes < 128 || wrappedKeyBytes > 8_192) {
      throw new Error("Encrypted backup recipient key is invalid");
    }
    const wrappedKey = Buffer.alloc(wrappedKeyBytes);
    await readExactly(handle, wrappedKey, fixedHeaderBytes);
    const header = Buffer.concat([fixedHeader, wrappedKey]);
    const ciphertextStart = header.byteLength;
    const ciphertextEnd = file.size - tagBytes - 1;
    if (ciphertextEnd < ciphertextStart) throw new Error("Encrypted backup is truncated");
    const authTag = Buffer.alloc(tagBytes);
    await readExactly(handle, authTag, file.size - tagBytes);
    const dataKey = privateDecrypt({ key: recipient, oaepHash: "sha256" }, wrappedKey);
    if (dataKey.byteLength !== 32) throw new Error("Encrypted backup data key is invalid");
    const iv = fixedHeader.subarray(magic.byteLength + lengthBytes);
    const decipher = createDecipheriv("aes-256-gcm", dataKey, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(authTag);
    try {
      await pipeline(
        createReadStream(inputPath, { start: ciphertextStart, end: ciphertextEnd }),
        decipher,
        createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      await unlink(outputPath).catch(() => undefined);
      throw error;
    }
  } finally {
    await handle.close();
  }
}
