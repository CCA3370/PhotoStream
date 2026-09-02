# 阶段 6 部署代码验证

日期：2026-09-02

范围：生产 OSS/CDN 适配、Debian 13 容器构建、任意目录启动/自动克隆、交互配置记忆、蓝绿更新/回滚和本地静态/自动化验证；不含真实部署或外部资源变更

## 结论

本阶段为 **Confirmed（本地实现范围）/ Partial（生产部署目标）**。用户要求的任意目录启动、自动克隆到受管目录、交互输入、值记忆、无须手改环境文件、拉取配置分支最新提交、健康检查后切流、失败回切和单版本应用回滚均已进入代码。当前 Linux amd64 环境已完成 API 生产镜像构建、容器入口模块解析探针及固定版本 Caddy 完整配置校验；带生产配置的健康启动、实际热重载和真实 2C2G Debian 13 主机仍未由本地验证覆盖，也没有获得 DNS、OSS/CDN、云端或生产发布授权，因此这些边界保持 **Unverified**。

## 变更与契约

- 新增阿里云 OSS V4 单次/分片直传、HEAD/完成/中止/删除，CDN Type A 私有读签名和文件刷新；媒体正文继续不经过香港 Web/API/PostgreSQL。
- OSS multipart provider upload ID 持久化并使用 compare-and-set 处理并发初始化；新增迁移 `0015_dapper_rhino.sql`。
- 生产配置强制 `OBJECT_STORAGE_DRIVER=aliyun`，缺少 RAM、媒体 Bucket 或 CDN key 时启动失败；本地开发适配器保持可用。
- 固定 Node 24.20.0 Trixie slim、PostgreSQL 18.6 Trixie、Caddy 2.11.4 Alpine，API/Web 镜像非 root 运行并使用只读根文件系统。
- API 构建统一内联全部 `@photostream/*` 工作区包，生产镜像不再依赖不会随 `pnpm deploy --prod --legacy` 输出复制的工作区 TypeScript 源文件；后续新增内部包也无需逐项维护 tsup 名单。
- API、Web、Caddy、Compose 使用四份独立 root-only 环境文件；Web/Caddy 不接收数据库或 RAM 密钥。
- `/etc/photostream/settings.sh` 记忆用户输入和 CSPRNG 密钥；无参数复跑直接更新，`configure` 回车保留已有值。
- 单个脚本可从任意当前目录运行；首次将仓库克隆到 `/opt/photostream` 并 `exec` 受管副本，后续复用该 checkout。仓库 URL/remote/分支进入 root-only 记忆配置，非空非 Git 目标会拒绝覆盖。
- 更新只允许干净工作树和 `git fetch` + `merge --ff-only`；目标槽迁移并健康后才热重载 Caddy。公网冒烟失败会恢复原槽；回滚冒烟失败也会二次恢复原槽。
- Caddy 的 `:8080` Web 服务端内部 API 路由在 blue/green 切换时统一把上游 `Host` 设置为配置的 `APP_HOST`；API 继续只信任正式应用域名和既有本地开发 Host，公网 `/api/*` 路由不改写 Host。
- Web 服务端会话读取只把 `401 AUTH_REQUIRED` 映射为未登录；来源校验、账号停用及其他 API 错误保留为显式失败，不再静默重定向到登录页。
- 部署脚本的幂等早退显式返回成功：禁用 swap、系统已有活动 swap，以及首位管理员已经初始化时均继续执行，不会被 `set -e` 误判为部署失败。
- PostgreSQL 始终单实例持久运行；回滚不执行逆向迁移，后续迁移必须继续采用扩展后收缩的向前兼容方式。
- `docs/15-debian13-deployment.md` 已扩写为完整操作手册，覆盖上线准备、全部交互输入、首次部署、秘密/状态文件、部署后验收、无停机更新、回滚、巡检、故障排查、备份恢复和验收记录模板。

## 新鲜证据

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| `pnpm --filter @photostream/api test` | 9 个文件、35 项通过 | 配置门禁、CDN 官方签名样例、反向代理信任及既有 API 单元行为 |
| `pnpm check` | 退出 0 | 233 个文件 lint；全 workspace 类型、81 项单元测试与串行构建；API 包含 migrate CLI，Next 14 个页面生成 |
| `pnpm --filter @photostream/web test` | 6 个文件、17 项通过 | 服务端会话成功、失效、来源错误、账号停用及其他 401 错误分类 |
| `bash -n deploy/deploy.sh deploy/deploy.test.sh` | 退出 0 | Bash 语法 |
| `bash deploy/deploy.test.sh` | 退出 0 | 配置/仓库值记忆、swap 禁用/已启用幂等早退、管理员已初始化早退、任意启动目录、自动克隆、受管脚本交接、错误目录拒绝、四份环境文件秘密隔离、blue/green 内部 API 目标和 Host 重写、公网路由不重写 Host、回滚公网失败二次回切 |
| `docker run --rm ... caddy:2.11.4-alpine caddy validate --config /etc/caddy/Caddyfile` | 退出 0，`Valid configuration` | 用 `write_routes blue` 实际生成的动态路由片段验证完整 Caddy 配置语法 |
| 修复前：`pnpm --filter @photostream/api deploy --prod --legacy <临时目录>` 后执行 `node dist/server.js` | 退出 1，复现 `ERR_MODULE_NOT_FOUND` | `dist/server.js` 保留 `@photostream/local-object-protocol` 导入，但 deploy 输出没有该包声明的 `src/index.ts`；工作区依赖随后按冻结锁文件恢复 |
| 修复后：`pnpm --filter @photostream/api build` 与 `rg -n '@photostream/' apps/api/dist -g '*.js'` | 构建退出 0；`rg` 退出 1、无匹配 | 三个 API JavaScript 入口均不再保留工作区运行时导入 |
| `docker build --target api --tag photostream-api:bundle-fix-local .` | API 镜像生成 | 实际执行 Node 24.20.0 API build、production deploy、迁移目录复制及非 root runtime 层组装 |
| `docker image inspect photostream-api:bundle-fix-local` | linux/amd64，运行用户 `node` | 本地验证镜像存在且保持非 root 契约 |
| `docker run --rm photostream-api:bundle-fix-local`（故意不提供环境文件） | 进入预期 `ConfigurationError`，不再出现 `ERR_MODULE_NOT_FOUND` | 容器入口已越过完整 ESM 模块解析；该负向探针不代表 API 健康启动 |
| `pnpm --filter @photostream/db db:generate` | 无额外 schema 变化 | 迁移与 schema 快照一致 |
| `git diff --check` | 退出 0 | 完整部署操作手册、README 入口与验证记录无空白错误 |
| PowerShell Markdown 结构与本地链接检查 | 通过 | 代码围栏/H1 结构正确，`docs/15-debian13-deployment.md` 引用的仓库内文档均存在 |

2026-09-02 首次整仓 `pnpm check` 在并行测试期间出现一次 OpenAPI 测试 5 秒超时（其余 API 测试通过）；紧接着 `pnpm --filter @photostream/api test` 的 9 个文件/34 项全部通过，随后完整 `pnpm check` 复跑退出 0。该现象归类为本机资源竞争下的瞬时超时，本次未修改无关 API 测试或产品代码。

失败路径复查先发现 Windows CRLF 检出导致 OCR 清单和 Biome 门禁失败；`.gitattributes` 固定 LF 后，当前工作树只在“LF 后匹配既有哈希”的文件上机械还原，再次整仓检查通过。独立复查还发现最初 `rollback` 公网冒烟失败后没有恢复原槽；已增加二次回切、停止失败目标槽和确定性脚本回归。

2026-09-02 API 蓝槽首次生产启动日志暴露 `@photostream/local-object-protocol/src/index.ts` 缺失。修复前已用 Dockerfile 等价 deploy 产物确定性复现；根因是该工作区依赖加入 API 后没有同步进入 tsup 的内联名单，而工作区包导出仍指向不会进入 production deploy 输出的 `src/index.ts`。修复采用 `@photostream/*` 统一内联规则，而不是只追加当前包名，避免相同遗漏随下一个内部依赖再次发生。

同日一次清空后重装在保存 root-only 配置后于 `install_command` 的 `ensure_swap` 调用失败；主机证据确认 `/swapfile` 已启用、2 GiB、权限 `0600`、`TYPE="swap"` 且 `/etc/fstab` 已持久化。根因是 `[[ 条件 ]] || return` 的裸 `return` 继承失败条件的退出码 1，并被 `set -e` 当作错误。修复为显式 `return 0`，并覆盖禁用创建、已有活动 swap 和管理员已初始化三个正常幂等分支。

同日生产首次登录在跳往 `/change-password` 后返回 `/login`。根因是 Web 使用 `API_INTERNAL_URL=http://caddy:8080` 读取会话时，内部 Caddy 反代沿用 `caddy:8080` 作为 Host，被 API 的全局来源校验以 `AUTH_ORIGIN_INVALID` 拒绝；会话读取又把全部 403 当作未登录。修复在动态 `active-api.caddy` 中对整个内部 API 入口统一写入配置的 `APP_HOST`，没有扩大 API trusted hosts；同时仅把 `401 AUTH_REQUIRED` 降级为无会话。

## 未验证与上线门禁

- 当前环境仅实际构建并检查了 API target，并以固定生产版本镜像完成 Caddy 配置校验；尚未执行 Web target、完整 `docker compose config`、Caddy reload、带生产环境文件的 API 健康启动、PostgreSQL 18.6 空库迁移或管理员初始化。
- 当前 Git for Windows 没有真实 `flock`，脚本测试验证了锁文件描述符跨受管脚本交接仍保持打开，但 `util-linux` 自动安装、Linux `flock` 互斥、root SSH/HTTPS 克隆仍需在 Debian 13 目标机验证。
- 未在 Debian 13 amd64/arm64、真实 2 vCPU/2 GiB/swap 上测量构建峰值、双槽并存 RSS、切流延迟、SSE 重连和磁盘增长。
- 未调用真实 OSS V4/multipart/CDN RefreshObjectCaches，未验证 CORS、私有回源、Type A 控制台有效期、Cache Key、Range、账单或删除一致性。
- 未修改 DNS、安全组、证书、OSS/CDN/RAM/IMM/EventBridge，也未部署或推送学生媒体；真实 HTTPS/ACME 和公网冒烟未执行。
- Playwright/设备/微信/Safari/辅助技术、校园网络、小范围相册和费用观察没有本阶段证据。
- 数据库加密备份/隔离恢复已有本地工具和阶段 5 证据，但目标主机的每日调度、备份 Bucket 上传、保留策略和恢复演练仍需按运维手册单独完成。
