# 中学部影像直播

“中学部影像直播”是面向北航实验学校中学部的校内图片与短视频直播平台。摄影、审核和管理人员通过浏览器完成素材上传与发布，师生和家长通过口令相册在微信或现代浏览器中查看活动影像。

## 当前状态

阶段 0 文档基线已经提交。用户于 2026-08-27 明确授权进入编码阶段；当前已完成阶段 1 工程基础、阶段 2 照片纵向闭环、阶段 3 审核运营和阶段 4 号码牌闭环的本地实现，包括浏览器照片派生与直传、口令公共相册、SSE/轮询、恢复队列、批量审核与筛选、三类下载策略、成员与审计、匿名日统计、口令轮换、持久删除任务、结构化号码规则、浏览器本地 OCR、人工确认以及精确号码/年级班级筛选。

自动号码候选当前明确保持 **experimental**：尚未取得 200 张 Git 外授权样片，也没有 Safari/移动设备召回率与性能门禁证据；手工标签和精确搜索闭环不依赖自动候选资格。项目仍未部署或修改任何 DNS、OSS、CDN 和香港主机。真实微信 WebView、Safari、VoiceOver/NVDA、学校隐私流程与目标 2C2G 主机检查均为 **Unverified**；详见[阶段 1 验证记录](docs/verification/phase-1-engineering-foundation.md)、[阶段 2 验证记录](docs/verification/phase-2-photo-vertical-slice.md)、[阶段 3 验证记录](docs/verification/phase-3-review-and-operations.md)和[阶段 4 验证记录](docs/verification/phase-4-bib-recognition.md)。

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

运行 API 前从 `.env.example` 提供本地值；号码功能还需要独立 `BIB_DATA_KEY`、`BIB_SEARCH_KEY` 与密钥版本，并通过 `BIB_OCR_AUTOMATION_STATUS` 保持当前资格状态。示例中的本地数据库口令不用于任何部署，秘密变量必须自行生成且不得提交。

## 已确定的核心约束

- 单学校、单团队、非商业使用，不开放公众注册。
- 香港 2C2G Linux 主机承载主站、API 和 PostgreSQL；杭州 OSS 与中国内地 CDN 承载全部媒体内容。
- 图片和视频二进制不得经过香港应用服务器；香港侧只保存必要元数据与业务状态。
- 阿里云只使用 OSS 与 CDN 的基础能力，不使用函数计算、图片处理、视频点播、DCDN/ESA、实时日志或其他可选增值服务。
- 图片在上传者浏览器本地生成 WebP 派生图；视频在浏览器能力允许时使用 WebCodecs 本地压缩。
- 可按相册启用本地数字号码牌 OCR；自动结果只作候选，人工确认后自动派生年级/班级并供口令相册筛选；无候选照片必须人工确认“无号码”。
- 新相册默认需要口令且禁止下载；管理员可对单场活动逐项放开。
- 第一版重点服务小型活动，设计目标为每场 5,000 张照片、50 条短视频、5 名并发上传者和 500 名并发观众。

## 文档索引

1. [产品需求](docs/01-product-requirements.md)
2. [系统架构](docs/02-system-architecture.md)
3. [领域模型与 API 设计](docs/03-domain-and-api-design.md)
4. [照片处理与上传链路](docs/04-photo-pipeline.md)
5. [视频处理与播放链路](docs/05-video-pipeline.md)
6. [前端与交互设计](docs/06-frontend-ux.md)
7. [安全、隐私与合规](docs/07-security-privacy.md)
8. [阿里云 OSS/CDN 配置](docs/08-aliyun-cdn-oss.md)
9. [费用控制](docs/09-cost-controls.md)
10. [测试与验收](docs/10-test-and-acceptance.md)
11. [开发路线图](docs/11-development-roadmap.md)
12. [号码牌识别与筛选](docs/12-bib-recognition.md)
13. [部署前待提供信息](docs/deployment-inputs.md)
14. [参考资料](docs/references.md)
15. [架构决策记录](docs/adr/README.md)

## 下一道门禁

进入视频闭环阶段前：

- 阶段 1–4 自动化与代码复查保持通过，自动号码候选在授权样本与设备门禁完成前继续标为 `experimental`；
- 真实微信/Safari 的 Tailwind/Base UI 风险继续按 **Unverified** 跟踪，不能用 Chromium 结果替代；
- 媒体二进制不得进入 Fastify/Next.js/香港数据库的架构不变量保持不变；
- 阶段 5 只能使用浏览器 Mediabunny/WebCodecs 完成视频重封装/转码，不引入 ffmpeg.wasm 或云端转码；
- 云端、DNS、部署和真实学生影像仍需各自单独批准。
