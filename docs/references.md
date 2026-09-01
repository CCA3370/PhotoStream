# 参考资料

查阅日期：2026-08-25 至 2026-09-01。云产品能力、价格、法规和浏览器支持会变化；进入编码时复核 SDK/API，进入部署时再次复核计费和控制台选项。

## 1. 竞品与产品范围

- [喔图云摄影官网](https://www.alltuu.com/)：用于理解照片直播、多端协作、AI、下载和营销等竞品边界；本项目只实现学校核心闭环，不复制其完整平台。
- [喔图图片直播教程](https://faq.alltuu.com/)：用于了解摄影师上传、相册管理和现场协作场景。
- [喔图 AI 找我/号码识别](https://faq.alltuu.com/04/a00d/9c62)：用于理解竞品号码/人脸找图场景；本项目不复制其公众人物库、跨相册或模糊搜索边界。

## 2. OSS 上传、存储与权限

- [客户端直接上传 OSS](https://help.aliyun.com/zh/oss/user-guide/uploading-objects-to-oss-directly-from-clients/)：直传相对业务服务器中转的优势与安全方式。
- [使用预签名 URL 上传文件](https://help.aliyun.com/zh/oss/user-guide/upload-files-using-presigned-urls)：V4 预签名 PUT 与 multipart 协调流程。
- [Node.js SDK 生成预签名上传 URL](https://help.aliyun.com/zh/oss/developer-reference/upload-objects-using-a-signed-url-generated-with-oss-sdk-for-node-js)：服务器本地签名实现依据。
- [OSS Multipart Upload](https://help.aliyun.com/zh/oss/user-guide/multipart-upload/)：分片数量、大小、恢复和请求计费边界。
- [PutObject](https://help.aliyun.com/zh/oss/developer-reference/putobject)：单次上传、禁止覆盖和标准响应头。
- [OSS 私有 Bucket CDN 回源](https://help.aliyun.com/zh/cdn/user-guide/grant-alibaba-cloud-cdn-access-permissions-on-private-oss-buckets)：CDN 只读私有源站授权。
- [OSS 计费概述](https://help.aliyun.com/zh/oss/billing-overview/)：存储、请求、流量与增值项边界。
- [OSS 请求费用](https://help.aliyun.com/zh/oss/api-operation-calling-fees)：PUT、UploadPart、HEAD 等请求的计数方式。
- [OSS 数据处理费用](https://help.aliyun.com/zh/oss/data-processing-fees)：图片处理属于独立计费，故明确不使用。

## 3. CDN 配置与费用

- [通过 CDN 加速 OSS](https://help.aliyun.com/zh/oss/user-guide/cdn-acceleration)：私有回源、缓存、URL 鉴权和流量风险。
- [配置 URL 鉴权](https://help.aliyun.com/zh/cdn/user-guide/configure-url-signing)：临时媒体 URL、规则条件和鉴权失败费用边界。
- [鉴权方式 A](https://help.aliyun.com/zh/cdn/user-guide/type-a-signing)：`auth_key=timestamp-rand-uid-md5` 的查询参数型签名、有效时间和签名串规则。
- [自定义 Cache Key](https://help.aliyun.com/zh/cdn/user-guide/create-custom-cache-keys/)：避免无关参数造成重复缓存与回源。
- [CDN 加速应用场景](https://help.aliyun.com/zh/cdn/product-overview/scenarios)：图片小文件和业务类型影响。
- [CDN 计费概述](https://help.aliyun.com/zh/cdn/product-overview/billing-overview)：基础下行与可选增值项目。
- [CDN 增值服务计费](https://help.aliyun.com/zh/cdn/billing-of-value-added-services-1)：HTTPS 请求、QUIC、实时日志等计费提醒。
- [CDN 请求数计费 FAQ](https://help.aliyun.com/zh/cdn/product-overview/faq-about-the-billing-of-requests)：304、恶意请求和 HTTPS 免费额度边界。
- [CDN 与 ICP 备案](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/use-alibaba-cloud-cdn)：中国内地加速域名备案要求。
- [CDN 使用限制](https://help.aliyun.com/zh/cdn/product-overview/limits)：中国内地/全球区域、请求头和刷新限制。

## 4. 禁用的云端计算与处理

- [什么是函数计算](https://help.aliyun.com/zh/functioncompute/what-is-function-compute)：事件驱动 Serverless 的功能说明。
- [函数计算计费](https://help.aliyun.com/en/functioncompute/billing-overview-of-fc)：CU 与公网流量属于独立费用，故本项目不创建 FC。
- [OSS 图片处理](https://help.aliyun.com/zh/oss/user-guide/overview-17/)：支持格式、QPS/吞吐和数据处理费用；本项目改为客户端派生。

## 5. 人脸找图、IMM 与事件通知

- [人脸识别技术应用安全管理办法](https://www.cac.gov.cn/2025-03/21/c_1744174262156096.htm)：特定目的、充分必要、显著告知、单独同意、不满十四周岁监护人同意、设备内存储/互联网传输、影响评估、替代方式和最短保存要求。
- [人脸识别应用备案公告](https://www.cac.gov.cn/2025-05/30/c_1750315544241157.htm)：存储数量达到 10 万人的备案起点；低于阈值不等于免除其他义务。
- [IMM 工作流模板与算子](https://help.aliyun.com/zh/imm/user-guide/workflow-templates-and-operators)：`Official:FaceManagement` 只启用 OSS 元信息与 FaceDetection，区别于标签/语义等更宽模板。
- [IndexFileMeta](https://help.aliyun.com/zh/imm/developer-reference/api-imm-2020-09-30-indexfilemeta)：显式索引 OSS 文件、异步完成和数据集边界。
- [IMM 人脸聚类 FAQ](https://help.aliyun.com/zh/imm/support/faq-about-image-management/)：至少三张合格高清人脸、索引/聚类延迟、增量批处理、按聚类查询图片及异步搜索结果只由 Notification 返回。
- [SearchImageFigureCluster](https://help.aliyun.com/zh/imm/developer-reference/api-imm-2020-09-30-searchimagefigurecluster)：用 OSS 参考图匹配人物聚类并返回相似度。
- [CreateFacesSearchingTask](https://help.aliyun.com/zh/imm/developer-reference/api-imm-2020-09-30-createfacessearchingtask)：异步相似人脸图片搜索、最大 100 个候选和任务通知。
- [SimpleQuery](https://help.aliyun.com/zh/imm/developer-reference/api-imm-2020-09-30-simplequery)：按 `Figures.FigureClusterId` 分页获取聚类照片，单页最多 100 条。
- [删除 IMM 文件元数据](https://help.aliyun.com/zh/imm/developer-reference/api-imm-2020-09-30-batchdeletefilemeta)：删除索引元数据会同步影响人脸聚类，但不会删除 OSS 原照片。
- [IMM 计费项](https://help.aliyun.com/zh/imm/product-overview/billable-items)：人脸检测、相似人脸图片、聚类、查询/索引存储和潜在 OSS 转换的独立计费依据。
- [IMM EventBridge 事件](https://help.aliyun.com/zh/eventbridge/user-guide/imm-events)：`imm:Task:FacesSearching` 等官方事件及相似人脸结果结构。
- [EventBridge HTTPS 签名](https://help.aliyun.com/zh/eventbridge/user-guide/signature-algorithm)：官方证书 URL、RSA 签名和 60 秒防重放验证流程。
- [EventBridge 事件总线计费](https://help.aliyun.com/zh/eventbridge/product-overview/billing-of-event-buses)：云服务专用事件发布、自定义 HTTPS 目标和跨地域流量价格。
- [MNS 计费](https://help.aliyun.com/zh/mns/product-overview/billing-overview)：杭州 Topic/Queue 按日资源占用费，是本项目选择 EventBridge 而非 MNS 的费用依据。
- [腾讯云人脸搜索](https://cloud.tencent.com/document/product/867/44994)与[百度人脸库/搜索](https://cloud.baidu.com/doc/FACE/s/5k37c1ij0)：用于比较 Person/Face 人员库语义、Top N 上限和容量；未选为相册图库主方案。

阿里 IMM 会返回年龄、性别、情绪、吸引力等额外属性。用户已选择未来后端忽略这些字段，但“不写入应用”不等于供应商没有处理；必须在告知和影响评估中如实覆盖。文档所列价格只用于 2026-08-31 数量级估算，不能替代开通前控制台和 PoC 账单。

## 6. 图片与浏览器 OCR

- [选择图片格式](https://web.dev/articles/choose-the-right-image-format)：WebP/AVIF 与传统格式的兼容和用途。
- [AVIF 的压缩与部署](https://web.dev/articles/avif-updates-2023)：AVIF 可能比 WebP 更小，但编码成本和链路需评估。
- [MDN 图片格式指南](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)：WebP、AVIF、JPEG/PNG 回退和浏览器支持。
- [PaddleOCR.js 官方浏览器 SDK](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md)：PP-OCRv5/v6、tiny/mobile 模型、自定义模型 URL、Worker 和 ONNX Runtime 配置。
- [PaddleOCR.js 架构](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/docs/architecture.md)：Worker、OpenCV.js、ONNX Runtime WASM 和自托管资源路径责任。
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)：浏览器本地推理、WebGPU/WASM 后端及隐私/成本特性。
- [ONNX Runtime Web 浏览器支持](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)：WebGPU、WASM、Safari与 Chromium 的执行后端差异。
- [PP-OCRv6 轻量模型](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html)：tiny/small 检测模型和边缘部署定位。

第三方浏览器媒体/OCR 库在进入编码前必须复核维护状态、许可证、包大小和安全记录；PaddleOCR.js 属于较新的浏览器 SDK，必须固定版本/资源哈希并以授权样本验证，文档选型不是跳过依赖审查的授权。

## 7. 技术栈版本

- [Node.js 发布与 LTS](https://nodejs.org/en/about/previous-releases)：选择 Node.js 24 LTS，不使用 Current 或 EOL 线路。
- [Next.js 16](https://nextjs.org/blog/next-16)：Next.js 16 的 Node/浏览器要求与自托管能力。
- [Fastify LTS](https://fastify.dev/docs/v5.7.x/Reference/LTS/)：Fastify 5 支持策略。
- [PostgreSQL 版本支持](https://www.postgresql.org/support/versioning/)：选择当前受支持的 PostgreSQL 18 小版本。
- [Docker Engine 安装到 Debian](https://docs.docker.com/engine/install/debian/)：Debian 13 Trixie 官方 apt 仓库、冲突包和 Compose 插件安装依据。
- [Debian 13 `util-linux` 文件清单](https://packages.debian.org/trixie/amd64/util-linux/filelist)：确认 `/usr/bin/flock` 由 `util-linux` 提供，供部署并发锁自动补齐依赖。
- [Node 官方容器镜像](https://hub.docker.com/_/node)：生产构建/运行固定 Node.js 24 Trixie slim 标签，不使用浮动 `latest`。
- [PostgreSQL 官方容器镜像](https://hub.docker.com/_/postgres)：固定 PostgreSQL 18.6 Trixie，并按 PostgreSQL 18 的 `/var/lib/postgresql` 卷布局持久化。
- [Caddy 官方容器镜像](https://hub.docker.com/_/caddy)：固定 Caddy 2.11.4 Alpine，持久化 `/data` 中的证书和私钥。

依赖清单和精确锁定版本只在获得编码授权后创建；实现时固定当前安全小版本，不使用 `latest` 作为生产部署策略。

## 8. UI 基础、性能与无障碍

- [Next.js Server 与 Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)：保持服务端主体并缩小客户端边界，避免公共相册加载工作台或媒体处理代码。
- [Next.js 懒加载](https://nextjs.org/docs/app/guides/lazy-loading)：灯箱与 OCR 等客户端模块按路由/操作加载。
- [Tailwind CSS 主题变量](https://tailwindcss.com/docs/theme)：使用语义 CSS 变量承载颜色、字体、间距和其他设计 Token。
- [Tailwind CSS 浏览器兼容](https://tailwindcss.com/docs/compatibility)：v4 依赖 Chrome 111、Safari 16.4、Firefox 128 及以上；目标环境不满足时官方建议保留 v3.4。
- [shadcn/ui Next.js](https://ui.shadcn.com/docs/installation/next)：Next.js、Tailwind、RSC 和按需生成组件的官方集成路径。
- [shadcn/ui 项目内源码](https://ui.shadcn.com/docs/new)：组件源码加入项目并由项目拥有和定制，不是全量运行时主题包。
- [shadcn/ui Base UI 默认决定](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)：新项目默认并推荐 Base UI；Radix 仍完整支持但不再是新项目默认。
- [shadcn/create 样式说明](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create)：Nova 使用较紧凑的 padding/margin，适合作为公共端与高密度工作台的共同结构起点。
- [shadcn `components.json`](https://ui.shadcn.com/docs/components-json)：base、style、RSC、Tailwind、图标、aliases 和 registry 的生成配置责任。
- [shadcn CLI](https://ui.shadcn.com/docs/cli)：`info`、`search`、`docs`、`add --dry-run/--view/--diff` 与 preset 操作边界。
- [shadcn monorepo](https://ui.shadcn.com/docs/monorepo)：多个 UI workspace 必须保持 style、icon library 和 base color 一致；首版只有 `apps/web` 使用 UI，因此不预建共享 UI workspace。
- [Base UI 概述](https://base-ui.com/react/overview/about)：无样式、可组合、现代浏览器和 React 兼容边界。
- [Base UI 无障碍](https://base-ui.com/react/overview/accessibility)：ARIA、键盘、焦点、标签和仍需应用层补足/测试的责任。
- [shadcn Base Drawer](https://ui.shadcn.com/docs/components/base/drawer)：移动抽屉、滑动、焦点、iOS 定位与响应式 Dialog/Drawer 组合。
- [shadcn Base Toast](https://ui.shadcn.com/docs/components/base/toast)：Base 项目的瞬时通知、状态、action 和 promise 接口；不与 Sonner 并存。
- [React Hook Form](https://react-hook-form.com/get-started)：复杂表单状态与字段数组；本项目继续以共享 Zod schema 和服务端校验为准。
- [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction)：长列表/网格只渲染视口附近元素，仍需与服务端游标分页分工。
- [Embla Carousel React](https://www.embla-carousel.com/docs/get-started/react/)：灯箱相邻媒体与触摸切换基础；模态语义由 shadcn/Base Dialog 承担。
- [Playwright 无障碍测试](https://playwright.dev/docs/accessibility-testing)：通过 `@axe-core/playwright` 捕获常见问题，同时明确自动检查不能替代人工评估。
- [Storybook 无障碍测试](https://storybook.js.org/docs/writing-tests/accessibility-testing)：共享组件状态和 axe 结果的开发期反馈与计划内自动门禁。
- [Core Web Vitals](https://web.dev/articles/vitals)：LCP、INP、CLS 及 p75 口径；本项目公共页采用 LCP 2.5 秒、INP 200ms、CLS 0.1 目标。
- [Uppy AWS S3 上传](https://uppy.io/docs/aws-s3/)：预签名 PUT/multipart 的可选传输参考；不授权使用 Uppy Dashboard，也不表示阿里云 OSS 契约可直接替换。

UI 依赖在进入编码前必须复核维护状态、许可证、React/Next.js 兼容、目标浏览器、按路由 gzip 包体和安全记录。Tailwind 主版本必须在生成 shadcn/ui 组件前固定；文档列出 v4 不代表可以跳过真实微信 WebView 门禁。

## 9. 隐私与数据跨境

- [中华人民共和国个人信息保护法](https://www.miit.gov.cn/jgsj/zfs/fl/art/2022/art_515a4b20c12f430eab54bb4f56d89f56.html)：个人信息处理、敏感信息、跨境提供和影响评估义务。
- [促进和规范数据跨境流动规定](https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm)：数据出境条件、阈值与仍需履行的告知/同意义务。
- [网络数据安全管理条例](https://app.www.gov.cn/govdata/gov/202409/30/520076/article.html)：自 2025 年实施的安全、备份、访问控制和跨境要求。
- [跨境规定答记者问](https://www.cac.gov.cn/2024-03/22/c_1712776611649184.htm)：未成年人信息等敏感个人信息范围说明。

学校使用、人数较少和媒体文件保存在杭州不能自动免除所有隐私、肖像或出境义务。上线前应由学校根据真实业务和主体身份完成正式判断。
