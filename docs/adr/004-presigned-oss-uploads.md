# ADR-004：使用精确 V4 预签名 OSS 上传

状态：Accepted
日期：2026-08-26

## Context

媒体不能经香港服务器中转，客户端又不能获得长期 AccessKey。上传对象需要精确限制路径、方法和有效期，同时照片原图与视频需要可恢复的 multipart。

## Decision

- 香港 API 预先创建上传意图和不可预测 object key。
- 普通对象使用短期 OSS V4 预签名 PUT。
- 大照片和视频由 API 协调 multipart 初始化、指定 part URL 和最终完成。
- 客户端只获得精确 URL，不获得 STS 凭证、Bucket 列举或任意前缀写权限。
- 完成后 API 使用 HEAD 校验对象，不依赖 OSS callback。

## Consequences

权限最小、不会暴露长期密钥，也避免 OSS callback 跨境超时丢通知。代价是 API 需要更多签名/分片协调请求，multipart 比单 PUT 产生更多 OSS 基础请求费用。

## Rejected Alternatives

- 业务服务器代理上传：媒体经过香港、双倍传输、主机负载不可接受。
- 浏览器持有 STS 前缀权限：实现简单但授权面更大，可在令牌期写入额外对象。
- 只用单 PUT：视频与大照片弱网失败后需整文件重传。
- 只依赖 OSS callback：回调无自动重试且跨境 5 秒窗口不够稳健。

## Revisit When

上传请求协调成为明确瓶颈，且可通过更严格的 STS session policy 达到同等权限与费用控制；任何改变都需先做滥用威胁评估。
