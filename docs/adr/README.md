# 架构决策记录

ADR 用于保存已经批准的重要决定、被拒绝方案和重审条件。实现者不得无记录地改变 Accepted 决策。

| ADR | 决策 | 状态 |
| --- | --- | --- |
| [ADR-001](001-client-side-media-processing.md) | 照片派生与号码候选在上传者浏览器完成；视频部分由 ADR-011 退役 | Accepted, Amended |
| [ADR-002](002-webp-over-avif.md) | 首版照片派生选择 WebP 而不是 AVIF | Accepted |
| [ADR-003](003-mainland-media-hong-kong-control-plane.md) | 杭州媒体数据面与香港控制面分离 | Accepted |
| [ADR-004](004-presigned-oss-uploads.md) | 使用精确 V4 预签名上传而不是代理或 STS 下发 | Accepted |
| [ADR-005](005-postgres-outbox-sse.md) | PostgreSQL outbox + SSE，不引入 Redis | Accepted |
| [ADR-007](007-school-privacy-defaults.md) | 学校相册默认口令、审核和禁下载 | Accepted |
| [ADR-008](008-assisted-local-bib-recognition.md) | 号码牌使用本地自动候选与人工确认 | Accepted |
| [ADR-009](009-lightweight-owned-ui-foundation.md) | 轻量可拥有 UI 基础；原 Radix 选择由 ADR-010 修订 | Accepted, Amended |
| [ADR-010](010-base-ui-and-shadcn-governance.md) | Base UI、base-nova、Lucide 与固定 shadcn 治理 | Accepted |
| [ADR-011](011-photo-only-product-boundary.md) | 产品收缩为纯照片边界并彻底退役视频 | Accepted |

每个 ADR 的重审触发条件只代表“允许重新讨论”，不自动改变当前决定。
