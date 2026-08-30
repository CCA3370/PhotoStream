# 纯照片产品边界退役验证

状态：**Confirmed（本地代码、迁移与 Chromium 自动化）**
日期：2026-08-30
对应决策：[ADR-011](../adr/011-photo-only-product-boundary.md)

## 1. 验证范围

本记录证明当前产品只保留照片上传、处理、审核、发布与下载能力，并彻底删除原视频适配和未来计划。范围覆盖共享契约、Fastify、Web、Storybook、本地对象存储夹具、Drizzle 当前 schema、向前迁移、测试矩阵、路线图和全部当前规格文档。

没有配置或修改 DNS、OSS、CDN、香港主机、CI 或生产资源。

## 2. 实现结果

- 删除 `docs/05-video-pipeline.md` 与 ADR-006，并由 ADR-011 固定纯照片产品边界；产品、架构、领域/API、UX、安全、云配置、费用、测试、路线图、部署输入、参考资料及既有阶段记录同步收敛。
- 共享契约删除媒体类型判别、相册视频下载开关、视频下载种类与响应字节字段；下载种类精确为 `preview | original`。
- API、Web、Storybook、容量夹具和 E2E 删除对应字段、分支与控件；照片配额直接统计相册全部媒体记录。
- 当前数据库 schema 删除 `media_kind`、`media.kind`、`media.duration_ms`、相册视频下载列及三个视频变体；`variant_kind` 只保留四个照片对象角色。
- 0010 向前迁移先检查媒体、变体、删除任务和统计引用；若发现旧视频数据则在任何删列或改写前失败，不静默丢失或伪装数据。
- 本地对象存储保留与文件类型无关的标准 byte-range 协议测试，但夹具改为 JPEG 原图；该协议能力不暴露任何产品上传或播放入口。

## 3. 新鲜验证证据

| 检查 | 环境与结果 | 状态 |
| --- | --- | --- |
| 当前引用扫描 | 排除历史迁移、当前退役 ADR/迁移/本记录和第三方 OCR 构建产物后，应用、包、脚本、当前规格与依赖清单无视频标识、路径、字段、依赖或计划 | Confirmed |
| Markdown 本地链接 | 只读检查 34 个 Markdown 文件，所有本地目标存在；被删除文档无残留链接 | Confirmed |
| Drizzle 一致性 | `drizzle-kit generate`：26 张表、`media` 19 列；`No schema changes` | Confirmed |
| 开发库迁移 | 本地 PostgreSQL 18.6 从 10 个迁移升级到 11 个；旧类型/列均不存在，变体精确为 `photo_480, photo_960, photo_1920, photo_original` | Confirmed |
| 迁移拒绝路径 | 隔离数据库执行 0000–0009，注入一条旧视频记录后运行 0010；迁移按设计报错，记录、旧列、旧类型和旧索引均保持不变 | Confirmed |
| 数据库集成 | `TEST_DATABASE_URL=... vitest run --config packages/db/vitest.integration.config.ts`：3/3 通过，包括当前媒体列和变体枚举精确断言 | Confirmed |
| API 集成 | `TEST_DATABASE_URL=... vitest run --config apps/api/vitest.integration.config.ts`：18/18 通过 | Confirmed |
| 仓库门禁 | `pnpm check`：Biome 194 文件；6 个 workspace 类型检查；47 个单元/契约测试；6 个构建全部通过 | Confirmed |
| Storybook | `pnpm --filter @photostream/web storybook:build`：2,462 个模块构建成功 | Confirmed |
| 浏览器全流 | Windows Headless Chrome 151；Playwright/axe 13/13 通过，运营流程只验证普通图与原图两种下载 | Confirmed |

测试后已关闭 Web、API、对象存储和专用 Chrome 进程，并删除隔离测试数据库、容器内迁移副本及 Chrome 临时配置目录。本地 PostgreSQL 开发容器继续运行。

## 4. 有意保留与未验证边界

- 0001–0009 SQL 与快照是已经发布并可能执行过的迁移历史，必须原样保留；0010 是当前权威退役边界。历史文件中的旧枚举名称不构成当前 schema 或产品支持。
- 自托管 PaddleOCR.js 构建产物包含上游 OpenCV.js 的通用捕获辅助代码；应用没有导入、调用或暴露该辅助能力。修改第三方哈希产物会破坏 OCR 供应链校验，因此引用扫描明确将其视为第三方生成物而非产品实现。
- 真实 Safari、微信 WebView、移动设备、VoiceOver/NVDA、校园网络和云端小流量检查没有在本次退役任务中重跑，继续保持 **Unverified**；本地 Chromium 结果不能替代这些环境。
