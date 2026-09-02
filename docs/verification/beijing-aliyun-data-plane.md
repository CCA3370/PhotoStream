# 北京阿里云数据面变更验证

日期：2026-09-02
范围：OSS/IMM/EventBridge 地域契约、API 适配、Web 上传 Origin/CSP、Debian 部署配置、ADR 与运维文档；不含真实云资源、数据迁移或部署

## 结论

PhotoStream 的当前本地契约已从杭州统一改为华北 2（北京）：OSS V4 签名地域固定为 `oss-cn-beijing`，公网 Endpoint 固定为 `https://oss-cn-beijing.aliyuncs.com`，IMM/EventBridge 地域固定为 `cn-beijing`。媒体与人脸参考照上传 Origin、IMM 请求、EventBridge 证书主机/事件地域和 CDN 客户端地域均使用同一北京基线。

本阶段为 **Confirmed（本地代码、文档与构建范围）**。没有创建、读取、复制、切换或删除任何 OSS、IMM、EventBridge、CDN、DNS 或生产资源；真实北京 V4 签名、CORS、私有回源、IMM 人脸能力、EventBridge 投递、数据迁移、账单和生产运行全部保持 **Unverified**。

## 实现与复查映射

| 要求 | 实现与复查结果 | 状态 |
| --- | --- | --- |
| OSS 固定北京 | API 配置只接受北京 region/Endpoint；媒体对象适配类型、参考照 OSS 客户端和 `.env.example` 同步 | Confirmed（代码） |
| IMM/EventBridge 同地域 | IMM 默认地域、Provider Endpoint、事件 payload 地域和官方证书主机统一由北京常量约束 | Confirmed（代码） |
| 浏览器只连接北京上传源 | 部署脚本生成北京媒体/参考照 Bucket Origin；Web CSP 夹具与人脸告知文案同步 | Confirmed（代码/单元） |
| 旧杭州配置不能静默切换 | 部署记忆配置升级为版本 3；旧版本在 `update`/运行环境渲染前失败并要求先迁移后 `configure` | Confirmed（脚本测试） |
| Accepted 决策有修订记录 | ADR-013 修订 ADR-001/003/007/012；当前产品、架构、安全、费用、运维、部署与参考资料同步到北京 | Confirmed（文档） |
| 历史证据不可伪装为北京验证 | 旧杭州阶段记录保留原结果并增加 ADR-013 历史说明；没有改写其当时的云端状态 | Confirmed（文档复查） |

实现后再次按文档反向复查：地域常量集中在 API 配置；参考照直接消费已校验的 OSS region，不再从 IMM 字符串拼接；部署端只保留不可被旧记忆配置覆盖的目标常量；没有引入跨地域兼容分支或自由 Endpoint，符合当前单一批准数据面的最小实现。

## 新鲜验证证据

环境：Linux 工作区，Node.js `v24.17.0`，pnpm `11.24.0`。所有命令均使用仓库夹具；未提供阿里云凭证，未调用云 API。

| 命令/检查 | 退出码与关键结果 |
| --- | --- |
| 先修改断言后运行 API 地域测试 | 退出 1；精确显示旧默认仍为 `cn-hangzhou` / `oss-cn-hangzhou`，北京 EventBridge 证书 URL被旧地域拒绝，证明测试确实覆盖缺口 |
| 先修改部署断言后运行 `bash deploy/deploy.test.sh` | 退出 1；旧脚本仍写 `SETTINGS_VERSION=2`，证明迁移门禁缺口 |
| `../../node_modules/.bin/vitest run --config vitest.config.ts src/config.test.ts src/face/eventbridge-verifier.test.ts src/face/provider.test.ts`（`apps/api`） | 退出 0；3 文件、12 测试通过 |
| `../../node_modules/.bin/vitest run --config vitest.config.ts src/lib/content-security-policy.test.ts`（`apps/web`） | 退出 0；1 文件、3 测试通过 |
| `bash deploy/deploy.test.sh` | 退出 0；版本 3、北京 API/Web 环境变量、旧配置拒绝、克隆/切换/回滚既有路径均通过 |
| `bash -n deploy/deploy.sh deploy/deploy.test.sh` | 退出 0 |
| `pnpm --filter @photostream/api typecheck` 与 `pnpm --filter @photostream/web typecheck` | 均退出 0 |
| 受影响文件 `biome check` | 退出 0；9 文件，无修复 |
| `pnpm check` | 退出 0；lint 232 文件；全部 workspace 类型检查通过；Contracts 19、本地对象协议 4、Object Store 6、Web 12、API 35 项测试通过；共享包、Object Store、Web 与 API 构建通过 |
| 活跃代码残留扫描（排除专门验证拒绝杭州值的负向测试） | 退出 0；`apps/`、`deploy/`、`.env.example` 无 `oss-cn-hangzhou` 或 `cn-hangzhou` |
| `git diff --check` | 退出 0 |

全量检查在扩展沙箱外运行，因为受限沙箱会让 `ali-oss` 依赖的本机接口枚举返回 `uv_interface_addresses` 环境错误；扩展运行仍只执行本地 lint、测试和构建，不连接阿里云。

## 官方能力复核

- [OSS 地域与 Endpoint](../references.md#2-oss-上传存储与权限)确认北京公网 Endpoint 为 `oss-cn-beijing.aliyuncs.com`。
- [IMM 接入点与同地域要求](../references.md#5-人脸找图imm-与事件通知)确认新版 IMM 支持北京 `cn-beijing`，且所用 OSS Bucket 应与 Project 同地域。
- [EventBridge 地域资料](../references.md#5-人脸找图imm-与事件通知)确认北京接入点可用。

这些资料只证明产品当前公开的地域能力和本地选型依据，不证明账号已开通、具体 API/事件已在真实北京资源上成功运行。

## 剩余门禁

1. 获得独立云端与生产变更授权后，创建或确认全新的北京媒体、备份和参考照私有 Bucket；现有 Bucket 地域不能原地修改。
2. 若存在杭州数据，按部署手册完成冻结、复制、对象核对、CORS/生命周期/RAM 重建、CDN 切源和可回滚窗口；不得由部署脚本自动删除旧资源。
3. 在北京重建 IMM Project/Dataset 与 EventBridge 规则，人脸功能保持关闭直至授权样本 PoC、删除读回、费用和学校门禁全部通过。
4. 真实 Debian 13、OSS V4、CDN、IMM、EventBridge、微信/Safari/辅助技术和生产资源继续分别记录，不得从本地 `pnpm check` 推断为通过。
