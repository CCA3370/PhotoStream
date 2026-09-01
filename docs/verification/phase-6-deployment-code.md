# 阶段 6 部署代码验证

日期：2026-09-01

范围：生产 OSS/CDN 适配、Debian 13 容器构建、交互配置记忆、蓝绿更新/回滚和本地静态/自动化验证；不含真实部署或外部资源变更

## 结论

本阶段为 **Confirmed（本地实现范围）/ Partial（生产部署目标）**。用户要求的交互输入、值记忆、无须手改环境文件、拉取配置分支最新提交、健康检查后切流、失败回切和单版本应用回滚均已进入代码。当前机器没有 Docker 与 Debian 13 目标环境，无法证明镜像/Compose/Caddy 在真实 2C2G 主机运行，也没有获得 DNS、OSS/CDN、云端或生产发布授权，因此这些边界保持 **Unverified**。

## 变更与契约

- 新增阿里云 OSS V4 单次/分片直传、HEAD/完成/中止/删除，CDN Type A 私有读签名和文件刷新；媒体正文继续不经过香港 Web/API/PostgreSQL。
- OSS multipart provider upload ID 持久化并使用 compare-and-set 处理并发初始化；新增迁移 `0015_dapper_rhino.sql`。
- 生产配置强制 `OBJECT_STORAGE_DRIVER=aliyun`，缺少 RAM、媒体 Bucket 或 CDN key 时启动失败；本地开发适配器保持可用。
- 固定 Node 24.20.0 Trixie slim、PostgreSQL 18.6 Trixie、Caddy 2.11.4 Alpine，API/Web 镜像非 root 运行并使用只读根文件系统。
- API、Web、Caddy、Compose 使用四份独立 root-only 环境文件；Web/Caddy 不接收数据库或 RAM 密钥。
- `/etc/photostream/settings.sh` 记忆用户输入和 CSPRNG 密钥；无参数复跑直接更新，`configure` 回车保留已有值。
- 更新只允许干净工作树和 `git fetch` + `merge --ff-only`；目标槽迁移并健康后才热重载 Caddy。公网冒烟失败会恢复原槽；回滚冒烟失败也会二次恢复原槽。
- PostgreSQL 始终单实例持久运行；回滚不执行逆向迁移，后续迁移必须继续采用扩展后收缩的向前兼容方式。

## 新鲜证据

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| `pnpm --filter @photostream/api test` | 9 个文件、34 项通过 | 配置门禁、CDN 官方签名样例、反向代理信任及既有 API 单元行为 |
| `pnpm check` | 退出 0 | 232 个文件 lint；全 workspace 类型、单元测试与串行构建；API 包含 migrate CLI，Next 14 个页面生成 |
| `bash -n deploy/deploy.sh deploy/deploy.test.sh` | 退出 0 | Bash 语法 |
| `bash deploy/deploy.test.sh` | 退出 0 | 四份环境文件秘密隔离、槽镜像状态、Caddy 路由、回滚公网失败二次回切 |
| `pnpm --filter @photostream/api deploy --prod --legacy <临时目录>` | 生产依赖与 `dist/server.js` 生成 | Dockerfile API deploy 步骤的本地等价探针；工作区依赖随后按锁文件恢复 |
| `pnpm --filter @photostream/db db:generate` | 无额外 schema 变化 | 迁移与 schema 快照一致 |

失败路径复查先发现 Windows CRLF 检出导致 OCR 清单和 Biome 门禁失败；`.gitattributes` 固定 LF 后，当前工作树只在“LF 后匹配既有哈希”的文件上机械还原，再次整仓检查通过。独立复查还发现最初 `rollback` 公网冒烟失败后没有恢复原槽；已增加二次回切、停止失败目标槽和确定性脚本回归。

## 未验证与上线门禁

- 当前环境没有 Docker 命令，未执行 Dockerfile 实际构建、`docker compose config`、Caddy validate/reload、PostgreSQL 18.6 空库迁移或管理员初始化。
- 未在 Debian 13 amd64/arm64、真实 2 vCPU/2 GiB/swap 上测量构建峰值、双槽并存 RSS、切流延迟、SSE 重连和磁盘增长。
- 未调用真实 OSS V4/multipart/CDN RefreshObjectCaches，未验证 CORS、私有回源、Type A 控制台有效期、Cache Key、Range、账单或删除一致性。
- 未修改 DNS、安全组、证书、OSS/CDN/RAM/IMM/EventBridge，也未部署或推送学生媒体；真实 HTTPS/ACME 和公网冒烟未执行。
- Playwright/设备/微信/Safari/辅助技术、校园网络、小范围相册和费用观察没有本阶段证据。
- 数据库加密备份/隔离恢复已有本地工具和阶段 5 证据，但目标主机的每日调度、备份 Bucket 上传、保留策略和恢复演练仍需按运维手册单独完成。
