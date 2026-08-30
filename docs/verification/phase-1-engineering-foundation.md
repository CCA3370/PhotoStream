# 阶段 1 工程基础验证记录

状态：本地实现与自动验证完成；真实设备和目标主机部分未验证
日期：2026-08-27

## 1. 实现范围

- pnpm 11 monorepo，Node.js 24 引擎门禁和精确锁文件；
- Next.js 16.3.3、React 19.2.8、Fastify 5.12.1、Zod 4 与 Drizzle；
- PostgreSQL 18.6 本地 Compose、显式 SQL 迁移、UUIDv7、用户/会话/审计表；
- Argon2id、首管理员一次性初始化、首登强制改密、会话 HMAC 当前/上一密钥、HttpOnly Cookie、CSRF、Origin/Host 与 RBAC 权限矩阵；
- 稳定错误契约、请求 ID、无正文/IP/Cookie 的结构化请求日志、OpenAPI；
- Tailwind CSS 4.3.3、`base-nova`/Base UI/Lucide shadcn 配置、系统字体和产品语义 Token；
- Button、Field、InputGroup、Dialog、Drawer、Select、ToggleGroup、Sidebar、Toast 试验面及依赖组件；
- PublicGalleryShell、UploadShell、StudioShell、登录/首登改密和服务端工作台会话门禁；
- Storybook、Playwright、axe 与 Biome 基础。

## 2. 新鲜证据

| 层 | 命令/动作 | 结果 | 状态 |
| --- | --- | --- | --- |
| 依赖 | `pnpm install --frozen-lockfile` | 冻结锁文件安装通过；锁文件已通过 24 小时成熟期策略，构建脚本仅白名单包可执行 | Confirmed |
| Peer/公告 | `pnpm peers check`、`pnpm audit --prod` | 无 peer 问题；无已知生产依赖漏洞 | Confirmed |
| 类型/契约 | `tsc --noEmit`、Vitest | contracts/API/DB/Web 类型通过；15 个单元与 API 契约测试通过 | Confirmed |
| 数据库 | PostgreSQL 18.6 空库迁移与 Vitest integration | 迁移成功；UUIDv7、唯一性和会话级联 2 项通过 | Confirmed |
| Web 构建 | `next build` | 生产构建成功，预期路由生成 | Confirmed |
| 组件 | `storybook build` | Storybook 10.5.10 静态构建成功 | Confirmed |
| 浏览器 | Playwright + Windows Headless Chrome 151 | 5 项通过：Token、Dialog 焦点、公共壳、匿名拒绝、登录后 Studio/Upload；axe 为 0 violation | Confirmed |
| 真实认证 | 浏览器登录与首登改密 | POST 登录 200，服务端重定向改密，改密 200，旧会话吊销、新会话有效，审计成功 | Confirmed |
| 数据最小化 | PostgreSQL/日志只读核对 | Argon2id；会话仅 64 位 HMAC 摘要；日志只有请求 ID、方法、路由、状态 | Confirmed |
| 密码基准 | 本机 Argon2id 单次 hash | 约 124ms；不是目标 2C2G 结果 | Partial |

失败重跑记录：Playwright 最初使用错误 Origin 得到预期 403；修正为 `APP_ORIGIN` 后通过。Dialog 测试最初早于 React 水合触发；改为条件式 React 水合等待后稳定通过。数据库容器曾随 Docker Desktop 退出码 255 停止，恢复现有 Compose/卷后迁移与测试通过。集成测试初版误用开发库并清除了本地测试账号；随后新增独立 `photostream_test`、启动初始化脚本和数据库名硬门禁，重跑通过。

## 3. 未验证与限制

- **Unverified**：iOS/Android 微信 WebView 的 Tailwind v4、Dialog、Drawer、Select、Sidebar、软键盘、安全区和滚动锁；
- **Unverified**：Safari、VoiceOver、NVDA 的完整键盘/屏幕阅读器人工流程；
- **Unverified**：香港目标 2C2G 的 Argon2id 200–500ms、内存和构建/运行预算；
- **Unverified**：任何真实 OSS/CDN、DNS、香港部署、校园网络或学生影像；
- 本记录只覆盖阶段 1；后续阶段的实现与验证由各自记录承担。
