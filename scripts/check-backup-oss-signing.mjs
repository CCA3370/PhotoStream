import assert from "node:assert/strict";

import { backupOssEndpoint, createOssAuthorization } from "./lib/oss-backup-upload.mjs";

const date = "Thu, 10 Sep 2026 03:20:00 GMT";
const headers = {
  "Content-Type": "application/octet-stream",
  "Content-Length": "123",
  Date: date,
  "x-oss-object-acl": "private",
  "x-oss-meta-sha256": "a".repeat(64),
};
const authorization = createOssAuthorization({
  method: "PUT",
  bucket: "example-backups",
  objectKey: "photostream/database/2026/09/photostream-20260910T032000Z.pstrbk",
  date,
  contentType: "application/octet-stream",
  headers,
  accessKeyId: "example-key",
  accessKeySecret: "secret",
});

assert.equal(authorization, "OSS example-key:kuDFZXk7YK7hS1qxf2V81gExOXU=");
assert.equal(backupOssEndpoint, "https://oss-cn-beijing.aliyuncs.com");
process.stdout.write("Backup OSS signing guard passed.\n");
