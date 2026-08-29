# 阶段 3 审核与运营验证记录

状态：本地实现与自动验证完成；真实设备、学校流程和云端删除/下载链路未验证
日期：2026-08-29

## 1. 实现范围

- 成员管理：管理员创建成员、角色/启用调整、首次改密、最近认证密码重置、最后一名启用管理员保护、真正变化时才吊销会话，以及请求内容绑定的幂等创建；
- 审核工作区：待审核/已发布/隐藏、上传不完整/失败、分类和上传者筛选，当前结果全选、显式键盘范围选择、批量发布/隐藏/恢复/改分类与逐项部分失败；
- 权限与状态机：上传者/审核员隐藏无权入口，审核员不能配置相册/分类或永久删除，管理员可结束、归档并从归档恢复为已结束；并发审核同一媒体只分配一次发布序号；
- 下载与观众端：普通图、原图、视频三个服务端独立开关，5 分钟签名下载、预计大小与安全文件名；原图未就绪时不显示入口，开启原图时明确提示 EXIF/GPS 风险；
- 运营设置：相册基础/访问/发布/下载/隐私与投诉分区，随机口令轮换立即递增访问版本并使旧访客会话失效；
- 匿名统计与审计：匿名标识在下一个 UTC 日边界到期，数据库只保存按日 HMAC 摘要；明细 30 天清理、日聚合保留；审计使用签名游标且不返回口令、签名 URL、对象 key、原始 IP 或号码值；
- 永久删除：管理员近期认证和相册标题二次确认，先隐藏，再用持久任务逐对象删除、CDN 刷新边界、指数退避、后台轮询和手工重试；全部成功后才清理变体/上传意图并进入 `deleted`；
- 本地对象数据面支持签名且幂等的 `DELETE`；生产 OSS 删除与 CDN 刷新通过接口隔离，本阶段没有创建或修改任何云资源；
- Base UI/shadcn 增加 Alert Dialog、Checkbox、Switch、Table、Tabs，并新增审核恢复、设置统计、成员和审计的虚构 Storybook 状态。

## 2. 新鲜证据

| 层 | 命令/动作 | 结果 | 状态 |
| --- | --- | --- | --- |
| 全仓门禁 | `pnpm check` | Storybook 图像输入防护、Biome 174 文件、全部 workspace 类型、35 个单元/契约测试和 6 个生产构建通过；Next 生成预期阶段 3 路由 | Confirmed |
| 迁移一致性 | `pnpm --filter @photostream/db db:generate` | 17 张表与迁移快照一致，无未生成 schema 变化 | Confirmed |
| 空库迁移 | 专用空库执行 `pnpm --filter @photostream/db db:migrate` | 0000–0006 共 7 条迁移成功，得到 17 张 public 表；验证后删除专用空库 | Confirmed |
| 数据库集成 | DB integration | UUIDv7、唯一约束和会话级联 2 项通过 | Confirmed |
| API/事务 | API integration | 11 项通过：照片事务、运行时 OpenAPI、筛选/上传者、归档恢复、批量部分失败、并发发布、删除双重失败恢复、下载/匿名统计、成员幂等/吊销/近期认证 | Confirmed |
| 容量回归 | API capacity | 5,000 媒体、84 页，分页 p95 5.28ms；500 SSE 交付 p95 174.45ms | Confirmed |
| 浏览器全流 | Playwright + Windows Headless Chrome 151 | 12 项通过；运营场景覆盖审核发布、三类下载开关、SSE 隐藏/恢复、永久删除、旧口令失效、角色负向、成员/审计和 axe；阶段 1–2 回归同时通过 | Confirmed |
| 独立浏览器检查 | `agent-browser` + Chrome 151 | 兼容性页和登录页有实际内容/交互元素，无 Next 错误覆盖层或页面异常；截图人工检查正常 | Confirmed |
| 组件 | `pnpm --filter @photostream/web storybook:build` | 图像输入防护通过；阶段 3 业务状态与既有壳层静态构建成功 | Confirmed |
| UI 基线 | `shadcn info --json` | 读回 Next 16.3.3、Tailwind v4、Base UI、`base-nova`、Lucide、RSC/TSX 和官方 registry | Confirmed |
| 生产依赖 | `pnpm audit --prod` | 无已知生产依赖漏洞 | Confirmed |
| 全依赖公告 | `pnpm audit` | 仅保留 2 条无修复版本的 Storybook-only `image-size@2.0.2` 高危公告 | Partial |
| 秘密/空白 | 仓库凭据模式扫描、`git diff --check` | 未发现测试管理员密码、私钥、常见云/API token 或带凭据 URL；无空白错误 | Confirmed |

全依赖审计保留的公告仍为 `GHSA-w3rx-r6r6-pgpr` 与 `GHSA-5p2g-fcmc-qvqq`，依赖路径仅为 `@storybook/nextjs-vite → vite-plugin-storybook-nextjs → image-size@2.0.2`，且上游仍无修复版本。Storybook 只监听本机；lint、启动和构建前继续执行魔数/扩展名防护，拒绝 ICNS、JXL、HEIF/HEIC 和 AVIF。该缓解不等于上游修复，故保持 **Partial**。

失败与复查记录：最初运行环境中的 PostgreSQL 容器已停止，按用户授权重新启动 Docker 后恢复；运营 E2E 先后修正了错误文案假设、缺失 Origin、未发布媒体 404 隐匿顺序、签名参数顺序和水合前点击等测试问题。全量并行回归进一步发现并修复了审核复选框水合竞态、审核员残留上传/配置入口和 Base UI 非受控设置字段警告。提交前代码复查还补齐媒体级并发锁、失败/不完整及上传者筛选、键盘范围选择、删除失败重试、`archived → ended`、成员幂等冲突/no-op 吊销、分类权限、分类更新 SSE 和匿名 Cookie 日边界。修正后相关窄测试、完整 PostgreSQL 集成、全量 Playwright 和 `pnpm check` 均重新通过。

## 3. 未验证与限制

- **Unverified**：真实阿里云 OSS 删除、CDN 鉴权/刷新、缓存与 5 分钟下载地址；当前只验证本地对象数据面和无缓存 CDN 适配边界；
- **Unverified**：iOS/Android 微信、Safari、移动 Chrome/Edge 的设置、表格、Tabs、Alert Dialog、下载与 SSE 行为；
- **Unverified**：VoiceOver、NVDA、真实键盘/触摸辅助技术完整流程；axe 和自动焦点断言不能替代人工验收；
- **Unverified**：学校对未成年人影像授权、隐私告知、删除/投诉负责人和原图下载流程的确认；当前文案与联系人只使用虚构测试内容；
- **Unverified**：香港目标 2C2G 的运营负载、真实校园网络、真实 OSS/CDN 账单和故障恢复；本地容量数字不是目标主机证据；
- 阶段 4–7 的号码牌、视频、完整加固和部署功能不由本记录声明完成；视频下载开关已由 API 强制执行，但照片媒体返回“尚未就绪”，完整视频下载在阶段 5 验证。
