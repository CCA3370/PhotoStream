import assert from "node:assert/strict";

import {
  backupOssEndpoint,
  backupOssRegion,
  createOssAuthorization,
} from "./lib/oss-backup-upload.mjs";

// Alibaba Cloud's published PutObject V4 canonical-request example.
const timestamp = "20250411T064124Z";
const headers = {
  "content-disposition": "attachment",
  "content-length": "3",
  "content-md5": "ICy5YqxZB1uWSwcVLSNLcA==",
  "content-type": "text/plain",
  "x-oss-content-sha256": "UNSIGNED-PAYLOAD",
  "x-oss-date": timestamp,
};
const signed = createOssAuthorization({
  method: "PUT",
  bucket: "examplebucket",
  objectKey: "exampleobject",
  timestamp,
  region: "cn-hangzhou",
  headers,
  additionalHeaders: ["content-disposition", "content-length"],
  accessKeyId: "LTAI****************",
  accessKeySecret: "yourAccessKeySecret",
});

assert.equal(
  signed.canonicalRequestHash,
  "c46d96390bdbc2d739ac9363293ae9d710b14e48081fcb22cd8ad54b63136eca",
);
assert.equal(
  signed.signature,
  "d3694c2dfc5371ee6acd35e88c4871ac95a7ba01d3a2f476768fe61218590097",
);
assert.equal(
  signed.authorization,
  "OSS4-HMAC-SHA256 Credential=LTAI****************/20250411/cn-hangzhou/oss/aliyun_v4_request,AdditionalHeaders=content-disposition;content-length,Signature=d3694c2dfc5371ee6acd35e88c4871ac95a7ba01d3a2f476768fe61218590097",
);
assert.equal(backupOssEndpoint, "https://oss-cn-beijing.aliyuncs.com");
assert.equal(backupOssRegion, "cn-beijing");
process.stdout.write("Backup OSS V4 signing guard passed.\n");
