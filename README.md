# 中学部影像直播

“中学部影像直播”是面向北航实验学校中学部的校内照片直播平台。摄影、审核和管理人员通过浏览器完成照片上传与发布，师生和家长通过口令相册在微信或现代浏览器中查看活动影像。

## 当前状态

阶段 0 文档基线已经提交。用户于 2026-08-27 明确授权进入编码阶段；当前已完成阶段 1–5 的本地实现，包括浏览器照片派生与直传、口令公共相册、SSE/轮询、PWA 离线壳与恢复队列、批量审核与筛选、两类下载策略、成员与审计、持久删除/孤立上传清理、结构化号码规则、本地 OCR、人工确认、精确号码/年级班级筛选、strict CSP、号码密钥轮换和加密备份/隔离恢复。产品边界现已收缩为仅照片，其他媒体类型不进入契约、数据库或路线图。

自动号码候选当前明确保持 **experimental**：用户已提供 813 张 Git 外本地测试照片，但尚无逐号码/四边形真值标注，也没有 Safari/移动设备召回率与性能门禁证据；手工标签和精确搜索闭环不依赖自动候选资格。项目仍未部署或修改任何 DNS、OSS、CDN 和香港主机。真实微信 WebView、Safari、VoiceOver/NVDA、学校隐私流程与目标 2C2G 主机检查均为 **Unverified**；详见[阶段 1 验证记录](docs/verification/phase-1-engineering-foundation.md)、[阶段 2 验证记录](docs/verification/phase-2-photo-vertical-slice.md)、[阶段 3 验证记录](docs/verification/phase-3-review-and-operations.md)、[阶段 4 验证记录](docs/verification/phase-4-bib-recognition.md)、[纯照片边界退役验证](docs/verification/photo-only-retirement.md)和[阶段 5 验证记录](docs/verification/phase-5-security-performance.md)。

2026-09-01 已按 ADR-012 完成人脸候选找图的本地代码实现：口令相册可在学校完成授权门禁后使用杭州阿里云 IMM 和 EventBridge，让观众提交一张参考照筛选可能包含同一人物的已发布照片。全局开关默认关闭；没有开通云资源或处理人脸样本，云端、真实数据库、准确率、设备与生产运行证据保持 **Unverified**。

同日已完成 Debian 13 生产部署代码：生产 API 使用杭州私有 OSS/内地 CDN，部署脚本交互收集并以 root-only 权限记忆配置，使用 Caddy + Docker Compose 蓝绿双槽更新到配置分支最新提交。目标 2C2G 主机、真实 Docker/Caddy、DNS/ACME 和阿里云链路尚未实际执行，仍保持 **Unverified**。

## 本地开发

要求 Node.js 24 与 pnpm 11。安装依赖后可运行：

- `pnpm install --frozen-lockfile`：按锁文件安装并执行供应链策略；
- `docker compose -f compose.dev.yml up -d postgres`：启动本地 PostgreSQL 18.6；
- `pnpm --filter @photostream/db db:migrate`：执行显式 SQL 迁移；
- `pnpm dev`：并行启动 Next.js、Fastify 与本地对象存储；
- `pnpm check`：运行 Biome、类型检查、单元/契约测试和构建；
- `pnpm --filter @photostream/web storybook`：查看组件与三类界面壳状态；
- `TEST_DATABASE_URL=postgresql://photostream:local-development-only@127.0.0.1:5432/photostream_test pnpm test:db`：运行隔离数据库集成测试；
- `pnpm --filter @photostream/web test:e2e`：运行浏览器/axe 验证。
- `TEST_DATABASE_URL=postgresql://photostream:local-development-only@127.0.0.1:5432/photostream_test pnpm --filter @photostream/api test:capacity`：运行 5,000 项与 500 SSE 独立容量门禁。
- `node scripts/check-bib-ocr-assets.mjs`：校验自托管 OCR 模型、Worker/WASM 哈希、远程回退和每设备 gzip 预算。
- `pnpm photos:audit-local`：只读审计 Git 忽略的 `test_photos/`，仅输出尺寸、体积、EXIF/GPS 与结构错误聚合。
- `pnpm db:backup -- --output /仓库外/backup.pstrbk`：使用仓库外 RSA 公钥创建认证加密备份。
- `pnpm db:restore -- --input /仓库外/backup.pstrbk`：只向空白 `photostream_restore_*` 隔离库执行单事务恢复。

运行 API 前从 `.env.example` 提供本地值；号码功能还需要独立 `BIB_DATA_KEY`、`BIB_SEARCH_KEY` 与密钥版本，并通过 `BIB_OCR_AUTOMATION_STATUS` 保持当前资格状态。示例中的本地数据库口令不用于任何部署，秘密变量必须自行生成且不得提交。

## 已确定的核心约束

- 单学校、单团队、非商业使用，不开放公众注册。
- 香港 2C2G Linux 主机承载主站、API 和 PostgreSQL；杭州 OSS 与中国内地 CDN 承载全部媒体内容。
- 照片二进制不得经过香港应用服务器；香港侧只保存必要元数据与业务状态。
- 基础照片功能只使用 OSS 与 CDN；人脸找图另行取得云端授权后只允许 ADR-012 列出的 IMM、临时 OSS 和 EventBridge，不使用函数计算、MNS、事件仓、DCDN/ESA 或实时日志。
- 照片在上传者浏览器本地生成 WebP 派生图。
- 可按相册启用本地数字号码牌 OCR；自动结果只作候选，人工确认后自动派生年级/班级并供口令相册筛选；无候选照片必须人工确认“无号码”。
- 本地已实现按口令相册启用、同意门禁的人脸候选找图；只返回“可能包含”，不建立姓名身份库或跨相册人物搜索，生产启用仍受独立门禁约束。
- 新相册默认需要口令且禁止下载；管理员可对单场活动逐项放开。
- 第一版重点服务小型活动，设计目标为每场 5,000 张照片、5 名并发上传者和 500 名并发观众。

## 文档索引

1. [产品需求](docs/01-product-requirements.md)
2. [系统架构](docs/02-system-architecture.md)
3. [领域模型与 API 设计](docs/03-domain-and-api-design.md)
4. [照片处理与上传链路](docs/04-photo-pipeline.md)
5. [前端与交互设计](docs/06-frontend-ux.md)
6. [安全、隐私与合规](docs/07-security-privacy.md)
7. [阿里云 OSS/CDN/IMM/EventBridge 配置](docs/08-aliyun-cdn-oss.md)
8. [费用控制](docs/09-cost-controls.md)
9. [测试与验收](docs/10-test-and-acceptance.md)
10. [开发路线图](docs/11-development-roadmap.md)
11. [号码牌识别与筛选](docs/12-bib-recognition.md)
12. [人脸候选找图](docs/14-face-search.md)
13. [部署前待提供信息](docs/deployment-inputs.md)
14. [运维、备份与事件响应手册](docs/13-operations-runbook.md)
15. [Debian 13 完整部署操作手册](docs/15-debian13-deployment.md)
16. [参考资料](docs/references.md)
17. [架构决策记录](docs/adr/README.md)

## 下一道门禁

进入阶段 6 小流量云端试运行前：

- 阶段 1–5 自动化与代码复查保持通过，自动号码候选在授权样本与设备门禁完成前继续标为 `experimental`；
- 真实微信/Safari 的 Tailwind/Base UI 风险继续按 **Unverified** 跟踪，不能用 Chromium 结果替代；
- 媒体二进制不得进入 Fastify/Next.js/香港数据库的架构不变量保持不变；
- 继续保持仅照片的产品、契约、数据库和测试边界，不增加其他媒体类型占位；
- 人脸找图在独立编码、云端和授权样本门禁前保持未实现/关闭，不把文档批准写成已验证能力；
- 用户提供并确认部署输入、学校隐私流程与目标主机权限；云端、DNS、部署、真实学生影像和生产发布仍需各自单独批准。
