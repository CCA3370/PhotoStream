# 阶段 2 照片纵向闭环验证记录

状态：本地实现与自动验证完成；真实设备、授权样片和云端链路未验证
日期：2026-08-28

## 1. 实现范围

- 相册、一级分类、照片、变体、上传意图、分片、访客会话和持久实时事件的 Drizzle schema 与显式迁移；
- 管理员创建默认口令相册、开始直播、创建分类，审核/自动发布两条照片状态路径；
- 本地对象数据面：HMAC 签名绑定方法、路径、过期、类型和长度，不可覆盖 PUT、HEAD、签名读取、Range、固定 8MiB multipart 与原子合并；
- Fastify 控制面：上传意图、单对象/分片签名与完成、HEAD 校验、事务发布序号、outbox/`NOTIFY`、访客口令、签名游标、增量 API 和 SSE 重放；
- 浏览器 Worker：JPEG/PNG/WebP 魔数、扩展名和 MIME 一致性，50MiB/100MP、APNG/动态 WebP 拒绝，EXIF 拍摄时间提取，方向应用，480/960/1920 WebP 与统一 JPEG 回退；
- 上传队列：单 Worker、最多 200 项、480/960 并行优先、有限重试/退避、17MiB 原图分片、IndexedDB 权威状态合并、暂停/继续/取消/重试、离页保护、缩略图、速率和剩余时间；
- 公共相册：服务端首屏 30 项、客户端签名游标续页、200 项后 TanStack Virtual 窗口化、口令会话、直连签名媒体 URL、灯箱、SSE 新媒体提示与 15 秒增量轮询降级；
- 审核页可发布待审核照片；公开表示从不返回或请求原图，Next 图片优化代理保持禁用。

## 2. 新鲜证据

| 层 | 命令/动作 | 结果 | 状态 |
| --- | --- | --- | --- |
| 依赖 | `pnpm install --frozen-lockfile` | 锁文件可冻结安装；供应链成熟期策略通过 | Confirmed |
| 全仓门禁 | `pnpm check` | Biome、全部 workspace 类型、29 个单元/契约测试和 6 个生产构建通过；Next 预期路由生成 | Confirmed |
| 迁移一致性 | `pnpm --filter @photostream/db db:generate` | 11 张表与迁移快照一致，无未生成 schema 变化 | Confirmed |
| 空库/数据库 | 重建专用 `photostream_test` 后运行 DB integration | 空库迁移成功；UUIDv7、唯一性和会话级联 2 项通过 | Confirmed |
| API 事务 | API integration | 4 项通过：审核发布/outbox/访客重放、精确对象校验与越权、17MiB multipart、REST/OpenAPI 与媒体正文拒绝 | Confirmed |
| 容量 | API capacity | 5,000 项、84 个游标页，查询 p95 5.45ms；500 SSE 同时收到持久事件，交付 p95 180.62ms | Confirmed |
| 长列表 | Windows Headless Chrome 151 | 5,000 项滚动到最后一项；挂载媒体 DOM 始终少于 100 | Confirmed |
| 完整浏览器 | Playwright + Chrome 151 | 10 项通过：合成 JPEG 直传、先连接 SSE 后发布、口令解锁、签名对象请求、灯箱、弱网三次失败/刷新续传、17MiB 三分片、暂停/继续/取消、壳层/鉴权、axe | Confirmed |
| 组件 | `storybook build` | 图像输入防护通过，Storybook 10.5.10 静态构建成功；`shadcn info --json` 读回 `base-nova`/Base UI/Lucide/Tailwind v4 | Confirmed |
| 生产依赖 | `pnpm audit --prod --audit-level high` | 无已知生产依赖漏洞 | Confirmed |
| 全依赖公告 | `pnpm audit --json` | 可修复的旧 esbuild 副本已精确 override；仍有 2 条无修复版本的 Storybook-only `image-size` 高危公告 | Partial |
| 媒体边界 | API 契约、公开响应和浏览器网络记录 | Fastify 拒绝 `image/jpeg` 正文；观众只请求带签名的 480/960/1920 对象，不出现原图或 `/_next/image` | Confirmed |

全依赖审计保留的两条公告是 `GHSA-w3rx-r6r6-pgpr` 与 `GHSA-5p2g-fcmc-qvqq`，路径仅为 `@storybook/nextjs-vite → vite-plugin-storybook-nextjs → image-size@2.0.2`，上游当前均标记无修复版本。Storybook 开发服务器显式只监听 `127.0.0.1`；lint、Storybook 启动和构建前运行仓库图像输入魔数/扩展名防护，拒绝 ICNS、JXL、HEIF/HEIC 和 AVIF。该缓解不冒充上游修复，公告继续保持 **Partial**。

失败重跑记录：本地对象存储最初在重复 PUT 清理临时文件时可能误删已有对象，改为临时文件加原子硬链接后测试通过。旧壳层 E2E 仍访问阶段 1 静态 `demo` 路由，改为动态创建真实相册。弱网断言最初只匹配 HTTP 错误文案，改为稳定业务状态并覆盖浏览器 `Failed to fetch`。SSE 最初被 Next 开发代理 gzip 缓冲，增加 `Cache-Control: no-transform` 与立即 flush 后，观众先建立连接、随后发布的真实场景通过。窗口化测试最初早于虚拟高度就绪滚动，增加就绪标记后稳定通过。完整审计发现的 esbuild 中危通过父子精确 override 消除，并验证 Drizzle 生成器仍可运行。

## 3. 未验证与限制

- **Unverified**：iOS/Android 微信、Safari、移动 Chrome/Edge 的上传、SSE/轮询、IndexedDB、内存回落、方向和滚动行为；
- **Unverified**：VoiceOver、NVDA 和真实键盘/触摸辅助技术完整流程；自动 axe 不能替代人工验收；
- **Unverified**：Git 外授权样片的横竖屏、透明 PNG、已有 WebP、暗光、舞台、运动和合影质量/体积记录；当前浏览器 E2E 只使用确定性非人物合成 JPEG/PNG；
- **Unverified**：香港目标 2C2G 的 5,000 项/500 SSE 资源曲线、移动端内存压力、真实弱网和校园网络；当前容量值来自本地开发机；
- **Unverified**：真实 OSS V4、杭州 OSS/CDN、Range、缓存、账单、DNS、香港部署和任何学生影像；本阶段没有创建或修改这些资源；
- 阶段 3–7 的运营、号码牌、视频、加固和部署功能不由本记录声明完成。
