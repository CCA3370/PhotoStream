# ADR-013：阿里云 OSS、IMM 与 EventBridge 数据面统一到北京

状态：Accepted
日期：2026-09-02

修订：[ADR-001](001-client-side-media-processing.md)、[ADR-003](003-mainland-media-hong-kong-control-plane.md)、[ADR-007](007-school-privacy-defaults.md)、[ADR-012](012-consent-gated-face-photo-search.md)

## Context

原架构把媒体、备份、临时人脸参考照、IMM 和 EventBridge 固定在华东 1（杭州）。用户现要求把 OSS 地域改为华北 2（北京），并要求若 IMM 只能在杭州则维持原地域。

阿里云当前官方资料确认：OSS 在北京的公网 Endpoint 为 `oss-cn-beijing.aliyuncs.com`；新版 IMM 支持北京 `cn-beijing` 和 `imm.cn-beijing.aliyuncs.com`；EventBridge 也支持北京。IMM 官方资料要求所用 OSS Bucket 与 Project 地域一致，以避免跨地域延迟和费用。因此“IMM 只能在杭州”的兜底条件没有触发，也不应把北京 OSS 与杭州 IMM 拼接成跨地域链路。

截至本决策，仓库没有创建、迁移或验证任何真实 OSS、IMM、EventBridge、CDN 或生产资源；既有云端状态仍为 **Unverified**。

## Decision

- 媒体、数据库备份和临时人脸参考照三个私有 OSS Bucket 统一使用华北 2（北京），V4 签名地域固定为 `oss-cn-beijing`，公网 Endpoint 固定为 `https://oss-cn-beijing.aliyuncs.com`。
- 人脸找图启用时，IMM Project、每相册 Dataset 和 EventBridge 云服务专用总线统一使用北京 `cn-beijing`；事件入口只接受 `aliyunregionid=cn-beijing` 和北京官方证书 URL。
- `cdn.cloverta.top`、香港控制面、数据库对象 key、浏览器直传/直读和“媒体正文不经过香港”的边界不变。
- 生产启动配置对地域和 Endpoint 采用精确校验，不接受杭州值或任意自定义 Endpoint，防止签名地域、Bucket 地域、IMM Project 和事件地域漂移。
- Debian 部署记忆配置升级为版本 3。旧版本代表杭州数据面，`update` 不得静默改写；必须先完成另行批准的北京资源准备和数据迁移，再运行 `configure` 明确提供北京 Bucket。
- 本决策只授权仓库内代码和文档变更，不授权创建、复制、切换、删除或计费任何云资源，也不授权部署。

## Consequences

北京 OSS、IMM 和 EventBridge 保持同地域，参考照签名、媒体索引和任务事件不需要跨地域访问；已有的隐私、最小权限、费用和删除门禁继续适用。

OSS Bucket 创建后不能直接修改地域。若真实杭州 Bucket 已存在，迁移必须创建新的北京 Bucket，复制并校验对象，重建北京 IMM/EventBridge 资源和人脸索引，切换 CDN 源站与应用配置，然后在保留可回滚窗口后另行批准清理。旧杭州 Dataset、事件规则或 Bucket 不得被描述为已自动迁移。

所有北京公网 Endpoint、真实 V4 签名、CORS、CDN 私有回源、IMM 功能、EventBridge 投递、数据迁移、账单和生产行为在获得独立云端授权并完成验证前保持 **Unverified**。

## Rejected Alternatives

- 仅把媒体 OSS 改到北京而保留杭州 IMM/临时 OSS：形成两套地域与 Endpoint，增加跨地域费用、延迟和配置错配风险，也违背 IMM 与所用 OSS 同地域的官方要求。
- 允许任意地域和 Endpoint 环境变量：当前产品只有一个批准的数据面，开放可配置值会让签名、CSP、部署脚本、事件验签和文档无从保持同一契约。
- 由部署脚本自动迁移或删除 Bucket：对象复制、CDN 切源、人脸重建和回滚涉及真实数据与计费，超出本地代码变更授权。

## Revisit When

学校要求新的数据驻留地域；北京不再支持所需 IMM/EventBridge 能力；真实延迟、费用或合规评估不能接受；或控制面迁入中国内地并需要重新设计同地域网络。
