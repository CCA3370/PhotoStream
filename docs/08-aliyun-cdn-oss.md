# 阿里云 OSS/CDN/IMM/EventBridge 配置

状态：已批准的目标配置；人脸资源为未来阶段；尚未在云端执行
更新日期：2026-08-31

本文件定义未来部署时的控制台配置与验收步骤。当前文档阶段不得创建、修改或删除任何阿里云资源。

## 1. 资源边界

基础照片功能只允许使用原 OSS/CDN 边界。未来人脸找图另行获得云端授权后，只允许增加以下明确资源：

1. 杭州地域私有 OSS 媒体 Bucket；
2. 杭州地域私有 OSS 数据库备份 Bucket；
3. 杭州地域私有 OSS 临时参考照 Bucket；
4. 已存在的阿里云 CDN 加速域名 `cdn.cloverta.top`；
5. 杭州 IMM Project 与每相册独立 Dataset；
6. EventBridge 云服务专用总线、精确 IMM 事件规则和一个香港 HTTPS 目标；
7. 按职责拆分的 RAM 用户/角色与必要控制 API。

不得创建函数计算、RDS、Tair、MNS、RocketMQ、事件仓、日志服务、通用云端媒体处理、DCDN/ESA、KMS 或其他未列明服务。IMM/EventBridge 只服务 ADR-012 的人脸找图，不能扩展到号码 OCR、内容标签、人物画像或通用分析。

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
| OSS 图片处理 | 基础功能关闭；未来只接受 IMM 读取 WebP 时不可避免且已对账的转换 |
| IMM | 基础功能不调用；未来只允许按媒体显式索引 `photo_1920`，不配置 Bucket 全量自动处理 |
| KMS 加密 | 不启用，避免独立 KMS 权限与费用 |
| 静态网站托管 | 关闭 |
| 日志转存 | 关闭 |
| 清单/通用数据索引 | 关闭；未来 IMM Dataset 索引不属于 Bucket 清单 |

Bucket 名由部署输入提供，代码不得写死。根前缀仅允许：

- `assets/`：前端哈希静态资源；
- `assets/models/bib-ocr/`：固定版本 PaddleOCR.js/OpenCV/ONNX Runtime 与 OCR 模型资源；
- `media/`：照片原图和派生图；
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

唯一自动生命周期规则：终止超过 1 天仍未完成的 multipart upload。照片原图和派生对象不做低频/归档转换或定期删除，符合“全部标准存储、长期保留”的决定。

应用自身仍需在任务过期时主动 Abort；Bucket 生命周期是最后兜底，不是主流程。

### 2.4 对象元数据

上传时固定设置：

- 正确、严格的 `Content-Type`；
- 派生图为 inline；照片原图为 attachment；
- `Cache-Control` 由对象类别决定；
- `x-oss-forbid-overwrite: true`；
- 不写入原文件名、人物姓名、活动标题或 GPS 到自定义 metadata。

## 3. OSS 临时参考照 Bucket（未来）

参考照使用独立杭州私有标准 Bucket，不绑定 CDN，也不与媒体/备份对象混放：

| 配置 | 目标值 |
| --- | --- |
| 地域/类型 | 华东 1（杭州）、标准存储 |
| ACL/版本控制 | 私有；版本控制关闭；禁止覆盖 |
| 唯一前缀 | `face-search/{searchId}/reference.jpg` |
| 生命周期 | 全部对象 1 天后强制删除；应用正常/失败后仍需立即删除 |
| CDN/网站托管 | 不绑定、关闭 |
| 日志/清单/复制/KMS | 全部关闭 |

CORS 只允许确切 `APP_ORIGIN` 的 `PUT`，允许/暴露头与媒体单 PUT 相同，不开放 GET、HEAD 或列举给浏览器。API 只为随机服务端 key 签发短期 PUT，并在完成后通过服务端 HEAD 校验 `image/jpeg`、不超过 3 MiB 和禁止覆盖；对象 metadata 不包含相册、人物、原文件名、同意内容或身份声明。

IMM 服务角色只可读取临时 Bucket 的 `face-search/` 前缀，应用每次只向 IMM 提交当前随机精确对象。删除任务必须覆盖正常完成、无人脸、多脸、质量不足、供应商失败、取消和超时；Bucket 生命周期只是异常兜底。

## 4. OSS 备份 Bucket

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

## 5. IMM 与 EventBridge（未来）

### 5.1 IMM

- Project 固定在华东 1（杭州），使用不可包含校名的部署标识；默认模板保持空，Dataset 明确使用 `Official:FaceManagement`。
- Project 只绑定同地域媒体 Bucket 和临时参考照 Bucket；服务角色对媒体 Bucket 仅可读 `media/.../1920.*`，对临时 Bucket 仅可读 `face-search/`，不得访问备份、原图、480/960、品牌或静态资源前缀。
- 每个相册创建独立、随机 Dataset；`CustomId` 只使用 PhotoStream 随机媒体 ID，不把相册标题、slug、姓名、学号或号码写入 IMM。
- 只通过 `IndexFileMeta`/`BatchIndexFileMeta` 显式索引已经发布且验证完成的 `photo_1920`；不绑定 OSS 上传触发器，不自动索引 Bucket 其他对象。
- 只允许索引、文件元数据删除、人物聚类、聚类查询、相似人脸搜索和 Dataset 生命周期 API。禁止标签、语义检索、故事、人物命名、视频、图片美化或其他算子。
- 相册结束 30 天、改公开、管理员关闭或授权范围失效时，先分页 `BatchDeleteFileMeta` 清空文件元数据，再 `DeleteDataset` 并读回不存在；逐照片隐藏/删除/退出索引使用 `DeleteFileMeta`/批量等价接口并读回结果。
- 应用只消费人脸数量/质量、聚类、URI、相似度和任务状态；年龄、性别、情绪、吸引力等额外字段不得持久化或输出。

### 5.2 EventBridge

- 使用杭州云服务专用总线接收阿里云官方 IMM 事件，不创建自定义总线、事件流或事件仓。
- 规则只匹配确切账号、地域、Project 及 `imm:FileMeta:Index`、`imm:Task:FigureClustering`、`imm:Task:FacesSearching` 等实现所需事件；不得转发 ActionTrail 通用事件。
- 唯一目标为 `${APP_ORIGIN}/api/v1/integrations/aliyun/eventbridge`，只发送完整必要事件；不投递参考照正文、凭证或额外调试信息。
- API 验证 EventBridge v2 RSA 签名、官方证书 URL、60 秒时间窗、账号/地域/Project/Dataset/TaskId 和事件 ID 幂等；失败返回非 2xx 触发受控重试。
- 不开启事件追踪、事件仓、日志投递或跨地域复制。香港目标产生的少量跨地域流量和自定义目标事件必须单独对账。

## 6. RAM 权限

### 6.1 应用签名用户

必须创建专用 RAM 用户或等效受限凭证，不能使用阿里云主账号 AccessKey。权限仅覆盖：

- 媒体 Bucket 指定前缀上的 PutObject、InitiateMultipartUpload、UploadPart、CompleteMultipartUpload、AbortMultipartUpload、ListParts、Head/Get 元数据和删除操作；
- 备份 Bucket 指定前缀上的备份 PUT、列举、读取和按保留策略删除；
- 必要的 CDN URL 刷新/配置读取 API，若与上传密钥拆分更安全则使用第二个 RAM 用户。
- 未来临时参考照 Bucket 精确前缀的 PUT 签名、HEAD 和 DELETE；不得与媒体删除权限混用。
- 未来 IMM 指定 Project/Dataset 的最小索引、聚类、搜索和删除权限；EventBridge 配置身份与运行时 IMM 身份拆分。

不得授予修改 Bucket ACL/Policy、删除 Bucket、跨区域复制、KMS、函数计算、通用云端媒体处理或账号级管理权限。浏览器永远不获得 RAM/STS 凭证，只获得单对象预签名 PUT。

### 6.2 CDN 私有回源角色

使用阿里云 CDN 访问私有 OSS 的官方服务角色，只给媒体 Bucket 只读权限。不得授予备份 Bucket 权限。

## 7. CDN 域名

### 7.1 基础

| 配置 | 目标值 |
| --- | --- |
| 域名 | `cdn.cloverta.top` |
| 加速区域 | 中国内地 |
| 业务类型 | 图片小文件 |
| 源站 | 杭州媒体 Bucket 外网 OSS 域名 |
| 私有回源 | 开启，同账号只读角色 |
| 回源协议 | HTTPS |
| 客户端协议 | HTTPS；HTTP 强制 301 到 HTTPS |
| HTTP | HTTP/2 开启 |
| TLS | TLS 1.2/1.3，关闭旧协议 |
| QUIC | 关闭 |

业务类型与当前控制台若不一致，部署前先记录现状并验证路径规则是否已支持，不得直接删除重建域名。照片是唯一媒体负载。

### 7.2 路径规则

| 路径 | 鉴权 | 边缘缓存 | 浏览器缓存 | 特殊规则 |
| --- | --- | --- | --- | --- |
| `/assets/app/{releaseId}/**` | 无 | 365 天 | 365 天、immutable | 哈希文件名；允许跨源加载 |
| `/assets/models/bib-ocr/{modelVersion}/**` | 无 | 365 天 | 365 天、immutable | 内部页面懒加载；观众端不请求 |
| `/branding/**` | URL 鉴权 | 365 天 | 2 小时 | 不覆盖对象 |
| `/media/**/photos/**` | URL 鉴权 | 365 天 | 2 小时 | 图片处理关闭 |
| 其他路径 | 拒绝或不缓存 | 不适用 | 不适用 | 防止暴露未知 Bucket 前缀 |

对象路径不可覆盖，因此长缓存不会产生版本错乱。永久删除时通过 CDN 刷新 API 清除对应 URL；常规发布和隐藏不刷新。

### 7.3 URL 鉴权与 Cache Key

- 对 `/branding/` 和 `/media/` 使用阿里云 CDN URL 鉴权规则，首版采用查询参数型签名，主/备 key 均由秘密配置提供。
- 普通预览 URL 有效 2 小时；下载 URL 有效 5 分钟。
- CDN 必须先验证鉴权，再从缓存 key 中剥离鉴权字段；不同访客访问同一不可变对象应命中同一缓存实体。
- 业务不使用其他功能性查询参数；自定义 Cache Key 删除未知参数，避免追踪参数或签名变化造成重复缓存。
- 鉴权失败仍可能产生少量流量和 HTTPS 请求费用，必须配合配额、告警和对象不可枚举路径。

### 7.4 明确关闭

- CDN 图片处理、自适应 WebP/AVIF、图片瘦身；
- 号码牌或其他阿里云/第三方托管 OCR；ADR-012 以外的视觉识别、模型推理、人物画像或内容标签；
- 实时日志投递、运营报表定制；
- DCDN/ESA、边缘函数、远程鉴权、WAF；
- QUIC 和其他单独请求计费功能；
- 自动预热整场媒体。

## 8. 静态前端资源

Next.js 哈希构建资源在发布时上传到 `/assets/app/{releaseId}/`。HTML 引用固定 release ID，旧资源至少保留到所有旧容器实例退出和浏览器缓存窗口结束后再清理。

OCR Worker、OpenCV.js、ONNX Runtime WASM 和 PP-OCR 模型使用独立 `/assets/models/bib-ocr/{modelVersion}/` 哈希版本。应用必须显式指定这些自托管地址，禁止运行时回退到第三方 CDN；模型版本升级与识别阈值校准作为一个整体发布，旧版本在相关上传任务结束前保留。

Service Worker、动态 HTML、API 和 SSE 保持主站同源，不放 CDN。跨域脚本/样式需要正确 CORS 和 CSP；构建文件必须具有哈希名称和正确 MIME。

## 9. DNS 与证书责任

`cdn.cloverta.top` 已绑定在用户可控的阿里云 CDN 账号，但根域 DNS 由朋友控制：

1. 用户从 CDN 控制台取得确切 CNAME 和证书验证记录。
2. 域名所有者执行 DNS 变更并回传截图/查询结果。
3. 用户验证 CNAME、备案状态、HTTPS 证书链和到期日。
4. 证书续期至少提前 30 天提醒；需要 DNS 验证时重复同一责任链。
5. 应用只读取 `MEDIA_BASE_URL`，未来更换子域不改数据库。

不得假设朋友长期无条件提供域名；上线前需有明确授权与迁移预案。

## 10. 小流量验收

只允许上传一组专用测试对象：一张照片的三个派生图和原图、一个哈希静态文件，以及一组固定版本 OCR Worker/WASM/模型文件。测试照片只在浏览器本地推理。逐项验证：

- OSS 匿名 URL 返回拒绝；
- 预签名 PUT 正常、改 key/方法/过期后失败、覆盖失败；
- CDN 有效签名成功、篡改/过期失败；
- 第二次访问出现缓存命中或 `Age` 增长；
- 不同签名访问同一对象不重复回源；
- 图片没有任何处理参数或图片处理账单；
- `/assets/` 无鉴权且长缓存，未知前缀不可访问；
- OCR 模型首次加载后命中长缓存，网络记录中没有第三方模型、WASM 或 OCR API 请求；
- 基础照片相册账单只出现批准的 OSS/CDN 项目。

测试完成后删除专用测试对象并确认 CDN 刷新；不得对生产 CDN 执行 500 并发或整场媒体预热测试。

未来人脸 PoC 必须使用另行批准的 Git 外授权样本和独立测试相册/Dataset，额外验证：

- 只有 1920 已发布对象被索引，隐藏/排除/删除后 IMM 元数据可读回确认删除；
- 一张单人参考照完成聚类搜索和 EventBridge 异步补查，零脸/多脸/低质量安全失败；
- EventBridge 只投递允许事件，伪造/重放/错误项目被 API 拒绝；
- 正常、失败、取消和超时参考照均删除，1 天生命周期仅作兜底；
- Dataset 在结束 30 天或测试结束后删除，控制台无遗留测试人脸数据；
- 账单分别列出 IMM 检测/聚类/搜索/索引、OSS 转换/临时请求和 EventBridge 事件/跨地域流量，没有 MNS、函数计算、事件仓、日志或其他算子。

本轮文档工作不执行上述操作，全部保持 **Unverified**。
