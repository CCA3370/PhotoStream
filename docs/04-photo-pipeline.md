# 照片处理与上传链路

状态：已批准的实施基线；人脸索引旁路已本地实现并默认关闭；管理端本地智能修图可在上传前、上传中和上传后使用
更新日期：2026-09-17

## 1. 目标

照片链路必须同时满足：快速进入直播、观众不自动下载原始大图、上传者弱网可恢复、媒体不经过香港服务器，以及基础上传/号码牌功能不使用任何阿里云图片/OCR 处理计费能力。ADR-012 批准的未来人脸候选找图只在照片发布且 1920 完成后走独立 IMM 旁路，不改变上传关键路径。

首版选择在上传者浏览器本地生成固定派生图。AVIF 不进入首版；WebP 在当前目标浏览器中具备更可靠的原生编码路径，且编码速度和设备内存风险更适合现场批量上传。

管理端本地智能修图与上传状态解耦：照片完成本地基础处理并进入 `LocalReviewPhoto` 队列后即可修图，不要求上传开始、上传完成或发布。上传中、上传完成和发布后仍使用同一编辑器。只要当前设备还能访问上传时保存的 `originalBlob`/本地变体，修图就必须优先使用本地源，不得重新从 CDN/OSS 获取真正原图。完整编辑设计见[管理端本地智能修图](16-local-photo-editing.md)。

## 2. 输入限制

| 项目 | 限制 |
| --- | --- |
| 格式 | JPEG、PNG、WebP |
| 单文件大小 | 不超过 50MB |
| 总像素 | 不超过 100MP |
| 动画 | 动态 WebP/APNG 首版拒绝，不自动取首帧冒充静态照片 |
| 文件数量 | 单次选择最多 200 张，可继续追加批次 |
| 相册配额 | 默认最多 5,000 张照片 |

客户端先检查文件扩展名、声明 MIME 和文件魔数；最终对象完成后，API 使用 HEAD 验证长度与 Content-Type。由于业务只允许受信内部上传者，首版不下载完整对象做服务器侧解码验证。

## 3. 本地处理

### 3.1 处理顺序

1. 在主线程读取最少量文件信息并创建本地队列项。
2. 将单个文件交给专用 Web Worker；同一设备默认只处理一张照片，防止批量解码撑爆内存。
3. 解析方向、像素尺寸和拍摄时间；忽略 GPS、相机序列号、作者、版权注释等字段。
4. 使用 `createImageBitmap`/浏览器解码器按正确方向生成最大 1920 长边的工作位图，不放大较小图片。
5. 从工作位图生成 1920、960、480 基础派生图。
6. 创建 `LocalReviewPhoto`，保存真正原始 `originalBlob`、本地 480/960/1920、格式、尺寸和本地任务状态。
7. 从此时开始照片即可进入修图，不要求已经创建上传意图或 `mediaId`。
8. 用户开始上传后，基础 480/960 优先上传；如果用户暂未上传，可继续在本地队列中审核、OCR 和修图。
9. 相册启用号码识别时，将 1920 工作图交给独立 OCR Worker；OCR 与修图均不得阻塞基础上传。
10. 将宽高、拍摄时间、派生文件大小和本地队列状态发送回主线程；OCR 结果通过独立号码接口提交。

处理任务必须支持取消；取消后关闭所有 Bitmap、撤销 Object URL 并清理只属于当前处理过程的临时引用。用于审核/修图的 `LocalReviewPhoto.originalBlob` 与本地变体按本地审核队列生命周期管理，**不得因为远端上传完成就无条件立即删除**。

### 3.2 固定基础派生规格

| 变体 | 最大长边 | 默认质量 | 用途 |
| --- | ---: | ---: | --- |
| `photo_480` | 480px | 70 | 手机网格、首屏和占位 |
| `photo_960` | 960px | 76 | 高 DPR 网格、审核预览和弱网灯箱 |
| `photo_1920` | 1920px | 82 | 普通灯箱和普通图下载 |
| `photo_original` | 不处理 | 不处理 | 真正上传原始版本；管理端恢复/重新编辑；无 active edit 时的最高质量下载 |

派生图默认使用有损 WebP；PNG 透明通道必须保留。浏览器实际编码 WebP 失败、返回错误 MIME 或不支持编码时，该文件的全部派生图统一退化为 JPEG，不能在同一照片上混用不可预测的格式。退化 JPEG 质量分别使用 72、78、84；透明区域统一合成到白色背景，不能依赖浏览器默认填充色。

质量参数是首版固定默认值。上线前使用校内典型室内、舞台、运动、合影和暗光样张检查体积与观感；只有形成可复现对比记录后才允许整体调整。

### 3.3 公开元数据

公开 API 只返回当前有效浏览变体实际宽高、纵横比、格式和签名 CDN URL。派生图通过 Canvas 编码自然去除 EXIF；数据库不保存原始文件名或 BlurHash。

为了避免布局偏移又不把图像派生内容送往香港，客户端只上报宽高与纵横比。页面在真实图片到达前使用由界面主题决定的中性骨架背景，不上报主色、BlurHash 或其他图像占位数据。

当媒体存在 active edit 时，公开 480/960/1920 必须解析到同一 edit revision；没有 active edit 时才返回基础 `MediaVariant`。观众端无需知道 revision 内部结构。

### 3.4 号码牌辅助识别

相册启用号码识别时，上传页懒加载自托管 PaddleOCR.js、OpenCV.js、ONNX Runtime 和 PP-OCRv6 tiny 模型。OCR 在专用 Worker 中对 1920 工作图执行，最多返回 8 个数字候选、置信度和 0–1 归一化四边形。

- 480/960 上传与发布流程不等待 OCR；
- OCR 失败时照片仍正常上传，用户改用手工补录；
- 只提交号码元数据，不提交裁剪图或任何图片正文；
- 自动候选为 `suggested`，人工确认后才可被观众搜索；
- 确认号码后由服务端按当前映射版本自动派生年级/班级，不由客户端自行提交属性；
- OCR 无候选、失败或候选全被拒绝仍保持待复核，绝不自动添加号码或标记无号码；
- 旧照片不从 CDN 自动补扫，只允许人工添加。

规则、模型、加密和搜索细节见[号码牌识别与筛选](12-bib-recognition.md)。

### 3.5 人脸索引旁路

人脸找图只复用已经上传并 HEAD 验证的基础 `photo_1920` 对象。媒体必须已发布、相册开关已通过授权门禁且未被管理员排除，API 才建立持久 IMM 索引任务。

- 不生成或保存新的人脸裁剪图/派生图；
- 不把人脸检测、索引或聚类放入 480/960 发布事务；
- 隐藏照片先从公共结果过滤，再异步删除 IMM 元数据；恢复后按排除门禁决定是否重建；
- 真正原图永不用于人脸索引，避免 EXIF、GPS 和过量像素进入供应商处理；
- 普通本地修图不触发重新做人脸索引；人脸搜索返回 mediaId 后由公共媒体解析器展示当前 active revision；
- 人脸任务失败只影响人脸找图，普通相册、号码确认和下载保持原状态。

完整流程见[人脸候选找图](14-face-search.md)。

### 3.6 管理端本地智能修图

修图入口从 `LocalReviewPhoto` 创建后就可用，覆盖整个生命周期：

```text
local（未上传）
→ uploading
→ uploaded / waiting review
→ published
```

四种状态都复用同一个 SourceResolver：

```text
当前 File
→ 当前内存 originalBlob
→ IndexedDB LocalReviewPhoto.originalBlob
→ 其他本地完整源
→ 以上都不存在时才允许 remote photo_original fallback
```

因此“上传后修图”不等于“从 CDN 修图”。只要本地源还在，已经上传甚至已经发布的照片仍然从本地原图重新渲染。

在 `mediaId` 尚未建立时，编辑以本地 draft 保存；用户点击“应用”后状态为 `applied_local`。一旦上传开始并取得 `mediaId`，客户端自动把本地 draft 同步为正式 edit revision。

每个完整 edit revision 生成四个不可变对象：

- `photo_480`；
- `photo_960`；
- `photo_1920`；
- `photo_download`：与处理源保持完整分辨率的当前修图版本最高质量下载对象。

**上传前已经应用修图时，基础四对象仍必须完整上传，同时额外完整上传上述四个 edit 对象。** 因此一张这种照片至少形成 8 个长期对象；active revision 只控制观众看到哪个版本，不允许省略基础归档对象。

edit revision 允许分阶段就绪：480/960 完成后为 `preview_ready`，1920/download 完成后为 `ready`。这样修图版仍可沿用“小图先公开、大图后补”的直播策略。

真正上传的 `photo_original` 永不覆盖。存在 active edit 时，观众端“原图下载”解析到该 revision 的 `photo_download`；只有没有 active edit 时才解析到基础 `photo_original`。

A 类确定性优化与 B 类 ONNX/WebGPU 本地 AI 都直接接入正常生产代码路径；不设置独立模型 PoC/晋级阶段。

## 4. 对象命名

基础对象路径：

- `media/albums/{albumId}/photos/{mediaId}/480.webp`
- `media/albums/{albumId}/photos/{mediaId}/960.webp`
- `media/albums/{albumId}/photos/{mediaId}/1920.webp`
- `media/albums/{albumId}/photos/{mediaId}/original.{safeExtension}`

编辑对象使用独立不可变 revision 路径：

- `media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/480.webp`
- `media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/960.webp`
- `media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/1920.webp`
- `media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/download.{safeExtension}`

对象 key 一经签发不可更改，所有 PUT 使用禁止覆盖语义。编辑对象不得覆盖基础对象。

## 5. 上传协议

### 5.1 创建上传意图

浏览器完成本地基础派生后，可以进入本地队列而不立即上传。用户开始上传时调用 API 创建上传意图，提交相册、分类、媒体种类、声明格式、各基础对象精确字节数、宽高、拍摄时间和客户端幂等键。不得提交 Bucket 或自定义 object key。

API 校验角色、相册状态、配额和输入范围，然后创建 `Media`、`UploadIntent` 与预期基础 `MediaVariant`。

如果本地存在 `applied_local` 修图，取得 `mediaId` 后额外创建 edit revision；**基础 UploadIntent 仍完整维护 `480/960/1920/original` 四对象，不因 edit 存在而删除或跳过任何一项。**

### 5.2 上传优先级

#### 未应用修图

1. 基础 480 与 960 并发上传，优先级最高；
2. 两者完成并经 HEAD 验证后，照片进入基础 `preview_ready`；
3. 基础 1920 上传；
4. 真正原图后台上传。

#### 上传前已经应用修图

基础链路完整执行：

1. base 480；
2. base 960；
3. base 1920；
4. base original。

同时增加修图链路：

1. edit 480；
2. edit 960；
3. edit 1920；
4. edit `photo_download`。

调度可以交错，以尽快满足首次发布；但最终完成条件必须包含 8 个目标对象全部完成。建议优先级：

```text
edit 480/960
≈ base 480/960
> base/edit 1920
> base original / edit photo_download
```

如果已应用 edit，base 480/960 ready **不能直接公开 base 版本**；必须等待 edit 480/960 达到 `preview_ready` 并绑定为 active 后再首次发布。与此同时，base 1920/original 继续后台上传，不得取消。

1920 尚未就绪时灯箱使用当前 active revision 的 960。active edit 的 `photo_download` 尚未就绪时，最高质量下载入口暂不可用，不能回退暴露 base original。

### 5.3 PUT 与 Multipart

- base/edit 480、960、1920 派生图始终使用单次 V4 预签名 PUT；
- 真正原图不超过 16MiB 时使用单次 PUT；
- 真正原图大于 16MiB 时使用 multipart，part 大小固定为 8MiB，最后一片可更小；
- edit `photo_download` 若实现层判定适合单 PUT，则使用单 PUT；超过配置阈值时可与 original 复用 multipart 策略；
- 预签名默认有效 15 分钟；过期后为同一对象重新签名，不创建新媒体或新 revision；
- 每个完成请求都带幂等键，API 通过 HEAD 确认对象大小与元数据后才更新状态。

默认网络并发为桌面 4 个 PUT、移动端 2 个 PUT。本地处理并发保持 1。base 和 edit 共用总网络并发预算，不能各自开一套并发导致现场网络被打满；B 的 GPU 推理队列独立于网络 PUT 调度。

## 6. 队列恢复

IndexedDB 保存：媒体 ID、文件指纹、基础对象完成情况、edit draft/revision 同步状态、multipart upload ID、已完成 part ETag、OCR 阶段、照片级复核结论、重试次数和最后错误。号码候选只在提交/确认所需期间保存在当前设备，并随本地任务清理。不得保存账号会话、AccessKey、CDN/号码数据密钥或过期预签名 URL。

- 页面刷新后，从 API 拉取权威基础上传和 edit revision 状态并合并本地队列；
- 尚无 `mediaId` 的本地 edit draft 完全从 IndexedDB 恢复；
- 支持 File System Access API 的桌面浏览器可保留文件句柄，但恢复时仍需重新授权；
- 无法持久化文件句柄的浏览器提示重新选择文件，通过大小、最后修改时间和本地指纹匹配原任务；
- 浏览器被系统关闭后不能承诺后台继续上传；重新打开后只重传未完成对象/分片；
- 上传 runtime 完成后可以删除 multipart 状态和临时工作位图，但只要 `LocalReviewPhoto` 仍属于当前审核工作区，其 `originalBlob` 与用于审核/修图的本地变体不得因为远端上传完成就自动清理；
- 管理员显式清理本地审核缓存、浏览器存储被回收或换设备后，修图 SourceResolver 才退化到远端源。

## 7. 发布与更新

发布事务分配相册内单调 `publishSequence` 并写入 outbox。观众端收到新媒体事件后请求最新表示。

没有已应用 edit 时，基础 480/960 ready 后沿用现有发布规则。

存在首次发布前已应用 edit 时，发布门禁改为：

```text
base 480/960 可以已 ready
+
edit 480/960 必须 preview_ready
+
edit 必须已绑定为 desired/active revision
→ 才允许首次发布
```

这只决定首次公开版本，不改变基础四对象必须继续完整上传的要求。

当 1920、真正原图、edit 1920 或 edit `photo_download` 稍后完成时发送 `media.updated`，只更新灯箱/下载能力，不把照片重新插入顶部。

应用、切换或撤销已发布媒体的 edit revision 同样只发送 `media.updated` 或等价更新事件；不得重新发布，不修改 `publishSequence`，不得让照片跳回列表顶部。

未来启用人脸找图时，基础 `photo_1920 + published` 触发私有持久索引任务，但不向相册 SSE 发送人物、聚类或搜索结果。索引可用性只能通过不含个人信息的相册配置状态表达。

号码确认、派生属性重算、无号码结论或标签失效发送不含号码值的 `media.bib.updated`。该事件只使当前号码/年级班级筛选重新查询，不改变照片发布序号。

## 8. 失败处理

| 失败 | 处理 |
| --- | --- |
| 格式/像素超限 | 选择阶段拒绝，说明具体限制 |
| 内存不足或本地解码失败 | 释放资源后单次重试；仍失败则标记不可重试 |
| WebP 编码不可用 | 统一退化 JPEG 派生图 |
| OCR 运行时/模型加载失败 | 不影响媒体上传，显示手工补录并允许稍后重试 OCR |
| OCR 无候选或候选不符合规则 | 不自动创建标签/属性/无号码结论；保持待复核，允许“手工添加”或人工“无号码” |
| 规则版本在识别期间改变 | 服务端拒绝旧版本候选，客户端拉取新规则后可重新识别/手工补录 |
| 属性映射缺失 | 号码仍可确认并精确搜索；只派生可确定属性，后台提示缺失，不能猜测 |
| IMM 索引/聚类失败 | 普通照片继续发布；仅人脸找图显示延迟/降级并由持久任务重试 |
| 预签名过期 | 保留媒体和完成分片，重新签名 |
| base 普通 PUT 网络失败 | 指数退避后重传该对象；edit 状态独立 |
| edit PUT 网络失败 | 不删除已完成 base 对象；保持 edit 同步失败并允许重试 |
| Multipart 单片失败 | 只重传该 part |
| HEAD 大小不符 | 不确认该变体，标记校验失败并重新上传 |
| base 480/960 仅一项完成 | 不进入基础 preview_ready，继续补齐 |
| edit 480/960 仅一项完成 | edit 不进入 preview_ready；若是 desired edit，则首次发布继续等待 |
| 真正原图长期失败 | 基础归档不完整，后台持续提示/重试；不能把 edit download 当成 base original 已完成 |
| edit download 长期失败 | active edit 仍可浏览 480/960/1920，但最高质量下载暂不可用；不能回退给观众 base original |
| 本地修图源缺失 | SourceResolver 才允许远端真正原图 fallback；不影响普通审核/发布 |
| 本地 AI 失败/OOM/device lost | 只终止当前 B 操作；A、基础上传、审核、发布和已有版本保持可用 |

## 9. 性能与验收

- 本地处理不得阻塞主线程造成超过 200ms 的连续长任务；
- 移动端同时只持有一张工作位图；完成后可观测内存必须回落；
- 首屏只请求可视区域 480/960，不预取最高质量下载对象；灯箱只预取相邻一张 1920；
- 省流量模式不预取相邻照片；
- 典型照片在输出视觉可接受的前提下，三个基础派生图合计目标不超过原始 JPEG 的 30%；该值是验收指标而非拒绝上传条件；
- 没有已应用 edit 的自动发布照片继续争取从 480/960 开始上传到 SSE 发布事件为正常上行网络下 5 秒级；
- 有上传前已应用 edit 的照片，首次发布可以等待 edit 480/960，但不能等待 base original、edit 1920 或 edit download；
- 上传前已应用 edit 的照片最终必须验证 **base 四对象 + edit 四对象共 8 个目标对象**全部存在并通过校验；
- OCR 模型和运行时只在启用功能的内部页面加载，压缩总量预算不超过 35MB并缓存一年；OCR 不能推迟基础 480/960 上传；
- 未来人脸索引和搜索不得改变上传端内存预算；观众端只做参考照去 EXIF/JPEG 编码，不加载人脸模型；
- 本地智能修图在当前设备存在 `originalBlob` 时，执行 A/B 不应产生远端真正原图 GET；远端原图 GET 仅允许本地源缺失的 fallback 场景；
- active edit 存在时，观众 480/960/1920 与最高质量下载必须来自同一 revision；最高质量下载命中 `photo_download`，不能绕过 active revision 获取真正上传原图。
