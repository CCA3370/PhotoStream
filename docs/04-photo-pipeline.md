# 照片处理与上传链路

状态：已批准的实施基线；人脸索引旁路已本地实现并默认关闭；本地智能修图已对齐真实审核/发布生命周期
更新日期：2026-09-17

## 1. 目标与真实状态机

照片链路必须同时满足：本地审核、一次点击完成审核通过+上传+发布、弱网可恢复、媒体不经过香港服务器、观众不自动下载原始大图，以及基础上传/号码牌功能不使用云端图片/OCR 处理。

当前本地审核队列真实上传状态只有：

```text
local
→ uploading
→ published

失败：uploading → failed → retry
```

**不存在稳定的 `uploaded / waiting review` 状态。** 待审核阶段发生在本地 `LocalReviewPhoto` 队列；用户点击“发布”时才创建上传意图并开始上传，全部要求对象完成后直接调用 `/publish`。

管理端本地智能修图从 `local` 状态即可使用；发布完成后仍可继续修图。完整设计见[管理端本地智能修图](16-local-photo-editing.md)。

## 2. 输入限制

| 项目 | 限制 |
| --- | --- |
| 格式 | JPEG、PNG、WebP |
| 单文件大小 | 不超过 50MB |
| 总像素 | 不超过 100MP |
| 动画 | 动态 WebP/APNG 拒绝，不自动取首帧 |
| 文件数量 | 单次选择最多 200 张，可继续追加 |
| 相册配额 | 默认最多 5,000 张 |

客户端先检查扩展名、声明 MIME 与文件魔数。最终对象由 API 通过 HEAD 验证长度、Content-Type 和预期对象状态。

## 3. 本地处理与审核队列

### 3.1 处理顺序

1. 用户选择照片；
2. 浏览器创建本地处理任务；
3. Worker 解析方向、宽高和拍摄时间；
4. 使用 `createImageBitmap`/浏览器解码器生成最大 1920 工作图；
5. 生成基础 `photo_1920/photo_960/photo_480`；
6. 创建 `LocalReviewPhoto`，保存真正原始 `originalBlob` 与三个本地派生 Blob；
7. `uploadState = local`，照片进入本地审核队列；
8. 此时即可做分类、精选、号码审核和 A/B 本地修图；
9. 只有点击“发布”才进入上传事务。

### 3.2 基础派生规格

| 变体 | 最大长边 | 默认质量 | 用途 |
| --- | ---: | ---: | --- |
| `photo_480` | 480px | WebP 70 | 手机网格、首屏 |
| `photo_960` | 960px | WebP 76 | 高 DPR 网格、审核预览、弱网灯箱 |
| `photo_1920` | 1920px | WebP 82 | 灯箱、普通图下载 |
| `photo_original` | 不处理 | 不处理 | 真正上传原始版本、管理端恢复/重新编辑、无 active edit 时最高质量下载 |

WebP 编码失败时三个基础派生统一退化 JPEG，质量约 72/78/84。透明 PNG 退化 JPEG 时合成白色背景。

### 3.3 本地原图保留

`LocalReviewPhoto.originalBlob` 是同设备后续修图的首选来源。

发布完成后不得因为 OSS 已有 `photo_original` 就立即无条件删除本地原图。只有以下情况允许失去本地源：

- 用户明确清理已完成本地记录；
- 浏览器存储压力回收；
- 本地队列生命周期结束；
- 数据损坏或不可读取。

本地源存在时，发布后修图不得重新从 CDN/OSS 下载原图。

## 4. OCR 与人脸旁路

### 4.1 号码 OCR

相册启用号码识别时，上传/审核端懒加载自托管 PaddleOCR.js、OpenCV.js、ONNX Runtime 和 PP-OCR 模型。

- OCR 使用本地 1920 工作图；
- 结果只作候选；
- 人工确认后才可搜索；
- OCR 失败不影响发布；
- 不上传裁剪图；
- 不从 CDN 自动补扫旧照片。

### 4.2 人脸索引

未来人脸找图继续使用已经上传并验证的**基础 `photo_1920`**，不使用真正原图，也不因普通本地修图重新建立索引。

人脸搜索返回 mediaId 后，观众端展示当前 active revision。

## 5. 本地智能修图与上传关系

### 5.1 `local` 状态

照片尚未上传，可完整使用 A+B。

应用修图只保存本地 draft/recipe：

```text
state = applied_local
```

不会创建 OSS 对象或 mediaId。

### 5.2 点击“发布”时冻结快照

点击发布就是审核通过。

发布瞬间冻结本次事务需要的：

```text
base variants
originalBlob
category
featured
bib state
applied edit recipe（如有）
pipeline/model version（如有）
```

随后：

```text
local → uploading
```

`uploading` 是短暂事务状态，不是新的审核阶段。为避免竞态，正在上传的发布快照不能被新的 recipe 动态替换。

### 5.3 未修图首次发布

现有逻辑保持：

```text
create UploadIntent / mediaId
→ upload base 480
→ upload base 960
→ upload base 1920
→ upload base original
→ upload/complete micro preview
→ verify all required objects
→ /publish
→ published
```

四个基础对象全部完成后才发布。

### 5.4 上传前已应用修图

基础版本必须完整上传：

```text
base 480
base 960
base 1920
base original
```

修图版本同时完整上传：

```text
edit 480
edit 960
edit 1920
edit photo_download
```

因此至少形成 8 个长期媒体对象。

推荐事务：

```text
1. create base UploadIntent / mediaId
2. bind local edit draft to mediaId
3. create edit revision
4. upload + complete base 4 objects
5. render edit from local originalBlob
6. upload + complete edit 4 objects
7. generate micro preview from首次公开版本
8. verify all required objects
9. publish transaction sets initial active revision
10. /publish completes
11. local state = published
```

**不得在 edit 480/960 先完成时提前公开。** 点击“发布”代表上传本次所需全部对象并公开，因此有 edit 时必须 8 个对象全部完成后才发布。

### 5.5 首次发布必须原子一致

有本地 edit 时，首次公开应在同一服务端发布事务中完成：

```text
verify base complete
verify edit complete
set initial active revision
assign publishSequence
publish
emit media.published
```

禁止：

```text
先 publish base
→ 再 apply edit
```

否则会短暂暴露未修图版本。

## 6. 发布失败与恢复

上传/发布失败：

```text
uploading → failed
```

失败照片仍保留在本地审核队列，并保留：

- `originalBlob`；
- 基础 variants；
- edit recipe；
- 已建立的 intent/mediaId；
- 已完成对象/Multipart 状态。

重试时先查询服务端权威状态，只补未完成对象。

如果失败后管理员修改了 edit recipe：

- 已完成的基础对象继续复用；
- 不覆盖旧 edit revision 对象；
- 新 recipe 使用新的 revision/key；
- 旧孤立 edit 对象进入清理流程。

## 7. 发布后修图

`published` 后可以继续修图：

```text
published media
→ SourceResolver
→ local originalBlob first
→ remote base photo_original only if local missing
→ render new edit revision
→ upload edit 480/960/1920/photo_download
→ verify all four
→ Apply
→ media.updated
```

### 7.1 发布后新 revision 必须完整后再切换

新 revision 上传过程中，观众继续看到旧 active 版本。

只有新 revision 四个对象全部 `ready` 后才能 Apply。新 revision 失败时旧版本不受影响。

### 7.2 Apply 不重新发布

Apply/Revert：

- 不重新分配 `publishSequence`；
- 不修改原发布时间；
- 不让照片跳到顶部；
- 不触发“新照片”；
- 只发送 `media.updated` 或等价事件。

## 8. 当前版本与下载解析

公开浏览：

```text
active edit 存在
→ edit 480/960/1920

无 active edit
→ base 480/960/1920
```

“原图下载”面向观众的语义为**当前版本最高质量下载**：

```text
active edit 存在
→ edit photo_download

无 active edit
→ base photo_original
```

真正上传的 base `photo_original` 永不覆盖。active edit 存在时普通观众不得绕过当前版本直接下载 base original。

## 9. 对象命名

基础：

```text
media/albums/{albumId}/photos/{mediaId}/480.webp
media/albums/{albumId}/photos/{mediaId}/960.webp
media/albums/{albumId}/photos/{mediaId}/1920.webp
media/albums/{albumId}/photos/{mediaId}/original.{ext}
```

编辑：

```text
media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/480.webp
media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/960.webp
media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/1920.webp
media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/download.{ext}
```

所有 key 不可变，不允许覆盖。

## 10. PUT / Multipart

- 基础和 edit 的 480/960/1920 使用单次预签名 PUT；
- base original ≤16MiB 使用单 PUT；
- base original >16MiB 使用 8MiB Multipart；
- edit `photo_download` 可按相同阈值选择单 PUT 或 Multipart；
- 预签名默认约 15 分钟；
- 失败后为同一对象重新签名；
- 完成接口通过 HEAD/ETag/bytes 等验证对象。

base 与 edit 共用同一个网络并发预算，避免一张修图照片同时开两套上传并发。

## 11. 发布事务与排序

`/publish` 是首次公开的唯一入口。

发布事务：

```text
all required objects ready
→ optional initial active edit ready
→ assign publishSequence
→ mark published
→ outbox/media.published
```

后续 1920/original 不存在“发布后继续补传”的常规路径；本设计要求首次发布前完成本次所需全部媒体对象。

发布后的 edit Apply/Revert 使用 `media.updated`，不改变 `publishSequence`。

## 12. 失败处理

| 失败 | 处理 |
| --- | --- |
| 格式/像素超限 | 本地选择阶段拒绝 |
| 本地解码失败 | 释放资源后有限重试，仍失败则保留明确错误 |
| WebP 编码失败 | 三个基础派生统一退化 JPEG |
| OCR 失败 | 不影响审核/发布，可人工补录 |
| PUT 失败 | 指数退避；可重试同一对象 |
| Multipart part 失败 | 只重传该 part |
| HEAD/complete 不一致 | 不发布，重新上传对应对象 |
| 有 edit 但任一 edit/base 对象未完成 | 不调用 `/publish` |
| 发布事务失败 | 保持 failed，可恢复/重试 |
| 发布后新 edit 失败 | 旧 active 保持不变 |
| 本地修图源缺失 | 才允许 remote base original fallback |
| WebGPU/OOM/device lost | 只终止当前 B 操作 |

## 13. 性能与验收

- 本地图片处理不得造成持续主线程长任务；
- 移动端同时只持有有限工作位图；
- 观众首屏只请求可视 480/960；
- 灯箱不自动下载最高质量对象；
- 上传前修图时不产生照片源远端 GET；
- 已发布照片若本地 `originalBlob` 仍在，再修图同样不得产生原图 GET；
- 未修图首次发布必须看到 4 个基础对象全部完成后才 `/publish`；
- 已修图首次发布必须看到 4 base + 4 edit 全部完成后才 `/publish`；
- 首次公开内容必须与 initial active revision 一致；
- 发布后 edit 未完整 ready 时不能切换 active；
- Apply/Revert 后列表排序保持不变。
