# 阿里云 OSS/CDN 配置

状态：已批准的目标配置；尚未在云端执行
更新日期：2026-08-26

本文件定义未来部署时的控制台配置与验收步骤。当前文档阶段不得创建、修改或删除任何阿里云资源。

## 1. 资源边界

只允许使用以下阿里云资源：

1. 杭州地域私有 OSS 媒体 Bucket；
2. 杭州地域私有 OSS 数据库备份 Bucket；
3. 已存在的阿里云 CDN 加速域名 `cdn.cloverta.top`；
4. RAM 用户/角色与基础控制 API。

不得创建函数计算、RDS、Tair、消息队列、视频点播、媒体处理、DCDN/ESA、KMS、日志服务或其他可能产生独立计费项的服务。

## 2. OSS 媒体 Bucket

### 2.1 基础配置

| 配置 | 目标值 |
| --- | --- |
| 地域 | 华东 1（杭州） |
| 存储类型 | 标准存储 |
| 读写权限 | 私有 |
| 版本控制 | 关闭；对象本身不可覆盖 |
| 传输加速 | 关闭 |
| 跨区域复制 | 关闭 |
| 图片处理/IMM | 不启用、不调用 |
| KMS 加密 | 不启用，避免独立 KMS 权限与费用 |
| 静态网站托管 | 关闭 |
| 日志转存 | 关闭 |
| 清单/数据索引 | 关闭 |

Bucket 名由部署输入提供，代码不得写死。根前缀仅允许：

- `assets/`：前端哈希静态资源；
- `assets/models/bib-ocr/`：固定版本 PaddleOCR.js/OpenCV/ONNX Runtime 与 OCR 模型资源；
- `media/`：照片、视频和媒体派生；
- `branding/`：学校 Logo 等受控品牌媒体；
- `orphaned/` 不作为常规写入路径，仅在明确修复流程使用。

### 2.2 CORS

上传 CORS 规则只允许确切 `APP_ORIGIN`：

- Methods：`PUT`；
- Allowed headers：`Content-Type`、`Content-MD5`、`x-oss-forbid-overwrite` 及签名实际要求的最小头集合；
- Expose headers：`ETag`、`x-oss-request-id`、CRC 校验响应头（若 SDK 实际使用）；
- Max age：600 秒；
- 不允许 `*` Origin，不开放匿名 GET，不允许客户端直接列举对象。

multipart 初始化、签名、完成和终止由香港 API 协调；浏览器只对精确 UploadPart URL 执行 PUT。

`/assets/app/{releaseId}/` 与 `/assets/models/bib-ocr/{modelVersion}/` 另设只读跨源规则或等价的 CDN 响应头规则：仅允许确切 `APP_ORIGIN` 的 GET/HEAD 模块与静态资源加载，暴露最小缓存相关头。该规则不得扩大媒体上传权限，也不得使用任意 Origin。

### 2.3 生命周期

唯一自动生命周期规则：终止超过 1 天仍未完成的 multipart upload。照片、视频和派生对象不做低频/归档转换或定期删除，符合“全部标准存储、长期保留”的决定。

应用自身仍需在任务过期时主动 Abort；Bucket 生命周期是最后兜底，不是主流程。

### 2.4 对象元数据

上传时固定设置：

- 正确、严格的 `Content-Type`；
- 派生图、海报和视频为 inline；照片原图为 attachment；
- `Cache-Control` 由对象类别决定；
- `x-oss-forbid-overwrite: true`；
- 不写入原文件名、人物姓名、活动标题或 GPS 到自定义 metadata。

## 3. OSS 备份 Bucket

备份使用独立私有 Bucket，不能作为 CDN 源站，防止通过 CDN 路径访问数据库备份。

| 配置 | 目标值 |
| --- | --- |
| 地域/类型 | 杭州、标准存储 |
| ACL | 私有 |
| CDN | 不绑定 |
| 内容 | 客户端加密后的 PostgreSQL 逻辑备份 |
| 保留 | 14 个日备份、8 个周备份 |
| KMS/日志/复制 | 全部关闭 |

备份加密在香港主机本地完成，OSS 只接收密文。恢复时下载到隔离目录，完成后安全清理临时明文。

## 4. RAM 权限

### 4.1 应用签名用户

必须创建专用 RAM 用户或等效受限凭证，不能使用阿里云主账号 AccessKey。权限仅覆盖：

- 媒体 Bucket 指定前缀上的 PutObject、InitiateMultipartUpload、UploadPart、CompleteMultipartUpload、AbortMultipartUpload、ListParts、Head/Get 元数据和删除操作；
- 备份 Bucket 指定前缀上的备份 PUT、列举、读取和按保留策略删除；
- 必要的 CDN URL 刷新/配置读取 API，若与上传密钥拆分更安全则使用第二个 RAM 用户。

不得授予修改 Bucket ACL/Policy、删除 Bucket、跨区域复制、KMS、函数计算、视频点播或账号级管理权限。

### 4.2 CDN 私有回源角色

使用阿里云 CDN 访问私有 OSS 的官方服务角色，只给媒体 Bucket 只读权限。不得授予备份 Bucket 权限。

## 5. CDN 域名

### 5.1 基础

| 配置 | 目标值 |
| --- | --- |
| 域名 | `cdn.cloverta.top` |
| 加速区域 | 中国内地 |
| 业务类型 | 图片小文件；视频通过路径规则追加 Range 优化 |
| 源站 | 杭州媒体 Bucket 外网 OSS 域名 |
| 私有回源 | 开启，同账号只读角色 |
| 回源协议 | HTTPS |
| 客户端协议 | HTTPS；HTTP 强制 301 到 HTTPS |
| HTTP | HTTP/2 开启 |
| TLS | TLS 1.2/1.3，关闭旧协议 |
| QUIC | 关闭 |

业务类型与当前控制台若不一致，部署前先记录现状并验证路径规则是否已支持，不得直接删除重建域名。图片是主负载，视频依靠独立 Range 规则满足播放。

### 5.2 路径规则

| 路径 | 鉴权 | 边缘缓存 | 浏览器缓存 | 特殊规则 |
| --- | --- | --- | --- | --- |
| `/assets/app/{releaseId}/**` | 无 | 365 天 | 365 天、immutable | 哈希文件名；允许跨源加载 |
| `/assets/models/bib-ocr/{modelVersion}/**` | 无 | 365 天 | 365 天、immutable | 内部页面懒加载；观众端不请求 |
| `/branding/**` | URL 鉴权 | 365 天 | 2 小时 | 不覆盖对象 |
| `/media/**/photos/**` | URL 鉴权 | 365 天 | 2 小时 | 图片处理关闭 |
| `/media/**/videos/**/poster-*` | URL 鉴权 | 365 天 | 2 小时 | 图片处理关闭 |
| `/media/**/videos/**/source.mp4` | URL 鉴权 | 365 天 | 2 小时 | 2MB Range 回源 |
| 其他路径 | 拒绝或不缓存 | 不适用 | 不适用 | 防止暴露未知 Bucket 前缀 |

对象路径不可覆盖，因此长缓存不会产生版本错乱。永久删除时通过 CDN 刷新 API 清除对应 URL；常规发布和隐藏不刷新。

### 5.3 URL 鉴权与 Cache Key

- 对 `/branding/` 和 `/media/` 使用阿里云 CDN URL 鉴权规则，首版采用查询参数型签名，主/备 key 均由秘密配置提供。
- 普通预览和视频播放 URL 有效 2 小时；下载 URL 有效 5 分钟。
- CDN 必须先验证鉴权，再从缓存 key 中剥离鉴权字段；不同访客访问同一不可变对象应命中同一缓存实体。
- 业务不使用其他功能性查询参数；自定义 Cache Key 删除未知参数，避免追踪参数或签名变化造成重复缓存。
- 鉴权失败仍可能产生少量流量和 HTTPS 请求费用，必须配合配额、告警和对象不可枚举路径。

### 5.4 Range 回源

仅对 `source.mp4` 路径启用“开启 Range 回源”，分片 2MB。验收必须确认：

- OSS 对合法 Range 返回 206；
- CDN 返回 `Accept-Ranges: bytes` 与正确 `Content-Range`；
- 播放器拖动时只回源所需片段；
- 超范围请求不会造成整文件异常下载；
- MP4 为 fast-start，首次播放无需先取文件尾。

### 5.5 明确关闭

- CDN 图片处理、自适应 WebP/AVIF、图片瘦身；
- 阿里云/第三方托管 OCR、视觉识别或模型推理 API；
- 视频转码、HLS 加密、音视频试看、听视频；
- 实时日志投递、运营报表定制；
- DCDN/ESA、边缘函数、远程鉴权、WAF；
- QUIC 和其他单独请求计费功能；
- 自动预热整场媒体。

## 6. 静态前端资源

Next.js 哈希构建资源在发布时上传到 `/assets/app/{releaseId}/`。HTML 引用固定 release ID，旧资源至少保留到所有旧容器实例退出和浏览器缓存窗口结束后再清理。

OCR Worker、OpenCV.js、ONNX Runtime WASM 和 PP-OCR 模型使用独立 `/assets/models/bib-ocr/{modelVersion}/` 哈希版本。应用必须显式指定这些自托管地址，禁止运行时回退到第三方 CDN；模型版本升级与识别阈值校准作为一个整体发布，旧版本在相关上传任务结束前保留。

Service Worker、动态 HTML、API 和 SSE 保持主站同源，不放 CDN。跨域脚本/样式需要正确 CORS 和 CSP；构建文件必须具有哈希名称和正确 MIME。

## 7. DNS 与证书责任

`cdn.cloverta.top` 已绑定在用户可控的阿里云 CDN 账号，但根域 DNS 由朋友控制：

1. 用户从 CDN 控制台取得确切 CNAME 和证书验证记录。
2. 域名所有者执行 DNS 变更并回传截图/查询结果。
3. 用户验证 CNAME、备案状态、HTTPS 证书链和到期日。
4. 证书续期至少提前 30 天提醒；需要 DNS 验证时重复同一责任链。
5. 应用只读取 `MEDIA_BASE_URL`，未来更换子域不改数据库。

不得假设朋友长期无条件提供域名；上线前需有明确授权与迁移预案。

## 8. 小流量验收

只允许上传一组专用测试对象：一张照片的三个派生图和原图、一条短 MP4 与两张海报、一个哈希静态文件，以及一组固定版本 OCR Worker/WASM/模型文件。测试照片只在浏览器本地推理。逐项验证：

- OSS 匿名 URL 返回拒绝；
- 预签名 PUT 正常、改 key/方法/过期后失败、覆盖失败；
- CDN 有效签名成功、篡改/过期失败；
- 第二次访问出现缓存命中或 `Age` 增长；
- 不同签名访问同一对象不重复回源；
- 图片没有任何处理参数或图片处理账单；
- 视频返回 206，可起播和拖动；
- `/assets/` 无鉴权且长缓存，未知前缀不可访问；
- OCR 模型首次加载后命中长缓存，网络记录中没有第三方模型、WASM 或 OCR API 请求；
- 阿里云账单只出现批准的 OSS/CDN 基础项目。

测试完成后删除专用测试对象并确认 CDN 刷新；不得对生产 CDN 执行 500 并发或整场媒体预热测试。
