# ADR-002：首版选择 WebP 而不是 AVIF

状态：Accepted
日期：2026-08-26

## Context

AVIF 在相同观感下通常能生成比 WebP 更小的文件，理论上进一步减少 CDN 下行。但首版派生必须由手机和电脑浏览器现场批量编码，不能依赖云端格式转换。

## Decision

- 480/960/1920 照片派生和视频海报默认使用 WebP。
- 浏览器无法可靠编码 WebP 时，该照片统一退化为 JPEG 派生图。
- 首版不生成 AVIF，也不同时保存 AVIF+WebP 两套派生。

## Consequences

编码兼容、速度和内存风险优于强制 AVIF，上传链路更可靠；代价是部分照片的 CDN 字节数可能高于 AVIF。只保存一套现代格式也避免翻倍 OSS 存储和 PUT 请求。

## Rejected Alternatives

- AVIF-only：本地编码和旧 WebView 兼容风险高。
- AVIF+WebP：派生、上传和存储数量翻倍。
- CDN 自适应格式：使用阿里云图片处理计费能力。

## Revisit When

目标上传浏览器均提供稳定、快速的原生 AVIF 编码，样片基准证明收益显著，且增加回退对象的存储/请求费用已获批准。
