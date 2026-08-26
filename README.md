# 中学部影像直播

“中学部影像直播”是面向北航实验学校中学部的校内图片与短视频直播平台。摄影、审核和管理人员通过浏览器完成素材上传与发布，师生和家长通过口令相册在微信或现代浏览器中查看活动影像。

## 当前状态

本仓库目前处于**设计与计划阶段**。仓库只包含 Markdown 文档；尚未创建源代码、依赖清单、数据库迁移、容器配置或云端资源。

在文档通过评审前，不应开始编码、部署、修改 DNS，或创建/变更阿里云 OSS、CDN 等资源。

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

开始编码前，必须同时满足：

- 所有文档不存在互相冲突的产品或技术决定；
- `docs/deployment-inputs.md` 中标记为“编码前必需”的项目已确认；
- 学校确认未成年人影像使用、隐私告知和删除投诉流程；
- 用户明确授权进入编码阶段。
