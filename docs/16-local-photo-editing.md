# 管理端本地智能修图

状态：已批准实施计划；直接接入生产代码路径，并在当前未对外投产的生产环境中验证、调参与迭代
更新日期：2026-09-17

## 1. 目标与真实生命周期

PhotoStream 管理端增加一套完全在浏览器本机运行的非破坏性照片优化能力，用于学校活动照片审核与快速修正。A+B 均不调用云 AI，也不要求服务器 GPU。

修图能力必须服从当前真实工作流：**待审核照片只存在于本地审核队列；点击“发布”本身就是“审核通过 + 上传 + 发布”。不存在一个长期稳定的“已经上传完成但仍待审核”状态。**

当前 `LocalReviewPhoto.uploadState` 的真实状态为：

```text
local
→ uploading
→ published

失败分支：uploading → failed → retry
```

因此修图生命周期固定为：

1. **`local`：本地待审核**——尚未上传，可完整修图；
2. **`uploading`：发布事务进行中**——点击发布后进入的短暂上传状态，不是审核阶段；
3. **`failed`：发布失败**——仍留在本地队列，可继续调整并重试；
4. **`published`：已上传并发布**——可继续修图，新修图作为独立 edit revision 应用。

完整上传链路以[照片处理与上传链路](04-photo-pipeline.md)为准。

## 2. 功能范围

### A：确定性智能优化

- 曝光；
- 白平衡（色温/色调）；
- 高光；
- 阴影；
- 对比度 / Tone Curve；
- Vibrance；
- Saturation；
- 基础锐化。

A 不要求神经网络，全部浏览器本地执行。

### B：本地 AI 修复

- AI 降噪；
- 轻度清晰化 / 去模糊；
- A+B 组合暗光增强。

B 使用自托管 ONNX 模型，通过 ONNX Runtime Web 在管理端浏览器执行，首选 WebGPU。

### 暂不进入

- 云 AI / 云图片处理；
- 换脸、瘦脸、大眼；
- 去路人/物体；
- Generative Fill；
- 扩图、换背景、换天空；
- 生成式重绘人物、衣物、文字、号码牌或场景；
- 默认超分辨率。

核心原则：**修复与优化，不生成新的事实性视觉内容。**

## 3. 固定设计原则

1. **本地待审核即可修图**：照片进入 `LocalReviewPhoto` 后，无需上传即可使用 A+B。
2. **发布即上传**：没有“uploaded / waiting review”稳定状态；点击发布才开始创建上传意图、上传对象并最终调用 `/publish`。
3. **本地源绝对优先**：只要当前设备有原始 `File/originalBlob`，无论照片是否已经发布，都禁止为了修图重新从 CDN/OSS 获取原图。
4. **双版本完整保留**：上传前已应用修图时，基础 `480/960/1920/original` 与修图 `480/960/1920/photo_download` 都必须完整上传。
5. **首次发布原子一致**：有本地已应用 edit 时，基础和 edit 全部完成并验证后，首次发布直接把 edit 设为当前版本；不能先发布 base 再切换。
6. **发布中使用冻结快照**：点击发布时冻结该次发布使用的 recipe/model version；`uploading` 期间不动态改变正在上传的版本。
7. **发布后编辑为新 revision**：新 revision 四个对象全部完成后再原子切换 active revision。
8. **真正上传原图永不覆盖**：`photo_original` 始终保留作管理端恢复/重新编辑来源。
9. **当前版本一致**：观众 480/960/1920 和最高质量下载必须来自同一 active 版本。
10. **故障隔离**：A/B 失败不能破坏本地审核、号码 OCR、基础上传或当前已发布版本。
11. **不可变对象**：所有 edit revision 使用新 object key，不覆盖历史对象。
12. **模型直接生产接入**：不设置独立 PoC 晋级阶段；在当前尚未正式投产的生产环境中直接验证和调参。

## 4. 本地审核队列与编辑草稿

当前 `LocalReviewPhoto` 保存：

- `originalBlob`；
- 原始格式、Content-Type、宽高；
- 本地 `photo_480/photo_960/photo_1920`；
- `intentId`；
- `mediaId`；
- `uploadState`；
- 审核与号码状态。

照片完成本地处理、进入队列后立即可以打开编辑器。

在 `mediaId` 尚不存在时，编辑必须作为本地草稿保存，例如独立 IndexedDB store：

```text
local-photo-edit-drafts
```

建议字段：

```text
localPhotoId
mediaId?
recipe
pipelineVersion
modelVersions
state        // draft | applied_local | publishing | synced | failed
sourceFingerprint
updatedAt
```

原则：

- recipe 和模型版本持久化；
- 不持久化 Tensor/GPU buffer；
- 可以缓存 960 级预览；
- 全分辨率输出需要时从本地原图重新渲染；
- 页面刷新后，只要 `originalBlob + recipe` 仍在即可恢复编辑状态。

## 5. SourceResolver：任何阶段都本地优先

所有入口共用同一个 SourceResolver。

### 5.1 预览源

```text
1. 当前 File / 内存位图
2. IndexedDB LocalReviewPhoto.photo_1920
3. IndexedDB LocalReviewPhoto.photo_960
4. 本地编辑预览缓存
5. 浏览器已有媒体 blob/cache
6. 远端 active/base 1920
7. 远端 active/base 960
```

### 5.2 全分辨率编辑源

```text
1. 当前 File
2. 当前内存 originalBlob
3. IndexedDB LocalReviewPhoto.originalBlob
4. 其他明确保存的本地完整源
5. 只有 1–4 全部不存在时，才允许读取远端 base photo_original
```

只要本地完整源命中，**不得产生 CDN/OSS 原图 GET**。

远端 fallback 只用于：

- 换设备；
- 本地队列被清理；
- 浏览器存储被回收；
- 本地文件损坏/不可读；
- 当前设备从未持有该照片原始文件。

即使当前 active 是某个 edit revision，重新编辑仍默认从真正 base `photo_original` / 本地 originalBlob + recipe 开始，避免在有损结果上反复编码。

## 6. `local`：发布前审核与修图

照片进入本地审核队列后，可以任意：

```text
查看
筛选
号码审核
精选
分类
A 智能优化
B AI 修复
Before/After
Reset
应用修图
```

点击“应用修图”只改变本地状态：

```text
state = applied_local
```

此时：

- 不创建云端对象；
- 不要求 `mediaId`；
- 不上传照片；
- 不产生照片源网络读取。

管理员仍可继续调整，直到真正点击“发布”。

## 7. 点击“发布”：冻结一次发布快照

“发布”就是审核通过并开始上传。

点击发布瞬间，客户端冻结：

```text
category
featured
bib state
base variants
originalBlob
是否存在 applied_local edit
edit recipe
pipeline version
model versions
```

这份 snapshot 是本次发布事务的唯一输入。

`uploading` 是短暂事务状态，不是可长期停留的审核状态。为了避免上传一半 recipe 又变化：

- 正在上传的 snapshot 不动态修改；
- UI 可查看当前修图，但不应把新的“应用”偷偷注入已经开始的事务；
- 若必须修改首次发布内容，应取消/失败后回到本地状态再发布；
- 如果已经发布完成，再修改则作为新的 post-publish revision。

## 8. 未修图照片的首次发布

没有 `applied_local` edit：

```text
点击发布
→ create upload intent / mediaId
→ 上传 base 480
→ 上传 base 960
→ 上传 base 1920
→ 上传 base original
→ 上传/完成 micro preview
→ 全部校验完成
→ /publish
→ local state = published
```

保持当前 PhotoStream 行为：**四个基础对象上传完成后才调用发布接口。**

不存在“基础 480/960 ready 后先公开、原图之后再补”的新行为。

## 9. 上传前已经应用修图的首次发布

如果点击发布时 snapshot 中存在 `applied_local`：

### 9.1 必须完整保留两套媒体对象

基础版本：

```text
base photo_480
base photo_960
base photo_1920
base photo_original
```

修图版本：

```text
edit photo_480
edit photo_960
edit photo_1920
edit photo_download
```

一张这种照片至少形成 **8 个长期媒体对象**，不计 micro preview 与历史 revision。

**修图版不能代替基础版。** active revision 只决定公开展示，不决定基础对象是否上传。

### 9.2 发布事务

推荐流程：

```text
1. 创建基础 UploadIntent，取得 mediaId
2. 本地 edit draft 绑定 mediaId
3. 创建 edit revision
4. 上传并完成 base 480/960/1920/original
5. 从同一 local original 渲染 edit full result
6. 上传并完成 edit 480/960/1920/photo_download
7. 生成当前版本 micro preview（应与首次公开版本一致）
8. HEAD/complete 验证全部要求对象
9. 在发布事务中把该 edit revision 设为初始 active revision
10. 调用 /publish
11. local state = published
```

第 9–10 步应保证首次公开时就是修图版，不能出现短暂 base 版本。

### 9.3 完整上传是发布前置条件

与此前草案不同，**不使用“edit 480/960 preview_ready 就先发布、1920/download 后补”的方案。**

点击发布代表审核通过和完整上传，因此：

```text
无 edit：4 个基础对象完成 → publish
有 edit：4 个基础对象 + 4 个 edit 对象完成 → publish
```

上传失败则不发布。

## 10. `failed`：上传失败后的行为

失败照片仍在本地队列：

```text
uploading → failed
```

允许：

- 查看失败原因；
- 重试；
- 回到编辑器调整 recipe；
- 继续使用本地 originalBlob；
- 复用已经完成且仍有效的基础上传对象/分片；
- 若 edit recipe 已改变，不覆盖旧 edit object，而创建新的 revision/key，并将旧孤立对象纳入清理。

失败不能丢失本地原图或编辑草稿。

## 11. `published`：上传后修图

发布完成后再修图：

```text
打开已发布照片
→ SourceResolver
→ 优先 local originalBlob
→ 本地不存在才 remote base photo_original
→ A/B 编辑
→ 创建新 edit revision
→ 生成并上传 480/960/1920/photo_download
→ 四个对象全部 complete/verified
→ Apply
→ active_revision_id 切换
→ media.updated
```

### 11.1 切换必须原子化

新 revision 未完整 `ready` 前：

- 观众继续看到旧 active 版本；
- 旧 480/960/1920/download 完全不受影响；
- 新 revision 失败不会造成半修图状态。

只有四个新对象全部验证后才允许 Apply。

这和首次发布不同：发布后没有必要为了几秒速度让观众进入一个只有小图的半完成 revision。

### 11.2 不重新发布

Apply 只：

```text
active_revision_id = new revision
emit media.updated
```

不得：

- 再调用 `media.published`；
- 修改 `publishSequence`；
- 把照片移到列表顶部；
- 产生“新照片”提示。

## 12. 回退与历史 revision

结构：

```text
Media
├─ Base
│  ├─ 480
│  ├─ 960
│  ├─ 1920
│  └─ original
└─ Edit revisions
   ├─ Revision A
   ├─ Revision B
   └─ Revision C ← active
```

恢复原始版本：

```text
active_revision_id = null
```

公共解析立即恢复：

```text
480      → base 480
960      → base 960
1920     → base 1920
原图下载 → base photo_original
```

切回历史 revision 只切 pointer，不重新编码。

## 13. 观众下载语义

“原图下载”对观众的实际语义固定为：**当前照片版本的最高质量下载。**

```text
active edit 存在
→ active edit.photo_download

无 active edit
→ base photo_original
```

active edit 存在时，普通观众不得绕过当前版本获取 base `photo_original`。

真正上传原图只保留用于：

- 管理端恢复原始版本；
- Before/After；
- 重新编辑；
- 审计/归档。

## 14. A：智能自动优化算法

分析使用最长边约 512–768 px 的本地缩略图，至少计算：

- RGB/luminance histogram；
- P1/P5/P50/P95/P99；
- shadow/highlight clipping；
- saturation distribution；
- dynamic range；
- neutral candidates；
- sharpness score；
- noise estimate。

自动曝光初始约束：

```text
-1.2 EV ~ +1.2 EV
```

高光/阴影初始自动范围：

```text
highlights -35 ~ +10
shadows    -15 ~ +40
contrast   -15 ~ +15
```

白平衡使用鲁棒中性色/Gray-World 类方法；舞台彩色灯光 confidence 低时不得强行中和。

Vibrance 优先于 Saturation，并保护典型肤色色相区域。

锐化使用 Unsharp Mask 或等价高频增强；清晰照片自动锐化应接近 0。

Recipe 示例：

```json
{
  "version": 1,
  "exposureEv": 0.34,
  "temperature": 0.07,
  "tint": -0.01,
  "highlights": -16,
  "shadows": 22,
  "contrast": 5,
  "vibrance": 9,
  "saturation": 0,
  "sharpen": 7
}
```

## 15. B：本地 AI 修复

生产模型全部自托管，懒加载，不允许运行时访问第三方模型 CDN。

首选非生成式恢复模型，例如 NAFNet 类 denoise/deblur 模型；若具体权重或 WebGPU 算子不兼容，在正常生产开发中换成功能等价、许可兼容的非生成式模型。

Runtime：

```text
Photo
→ Tile splitter
→ ONNX Runtime Web
→ WebGPU
→ Denoise/Deblur
→ Tile merge
→ A color pipeline
→ Export
```

初始 tile 可从：

```text
256 × 256
32 px overlap
reflect padding
weighted feathering
```

开始，并在生产环境直接调参。

B 固定单并发；允许有限 tile 降级，例如 384 → 256 → 192。OOM/device lost 只终止当前 B 操作，不影响审核或已发布版本。

AI 降噪强度可通过原图和输出混合：

```text
output = original * (1-strength) + restored * strength
```

AI 清晰化必须管理员显式启用，不由“一键智能优化”默认执行。

## 16. 最终编辑渲染 Pipeline

```text
1. Resolve local source first
2. Decode / Orientation
3. AI Denoise（可选）
4. AI Deblur（可选）
5. Exposure
6. White Balance
7. Highlights / Shadows
8. Contrast / Tone Curve
9. Vibrance / Saturation
10. Sharpen
11. Encode full-resolution photo_download
12. Derive photo_1920
13. Derive photo_960
14. Derive photo_480
```

`photo_download` 必须保持处理源完整分辨率，不得降成 1920 冒充最高质量版本。

Pipeline 必须版本化，例如：

```text
local-edit-v1
```

## 17. 数据模型

### `media_edit_revisions`

建议字段：

```text
id
media_id
created_by
status               // rendering | ready | applied | discarded | failed
pipeline_version
recipe_version
recipe_json
denoise_model
denoise_model_version
deblur_model
deblur_model_version
source_kind
source_etag
source_origin
created_at
ready_at
applied_at
failure_code
```

### `media_edit_variants`

```text
edit_revision_id
kind                 // photo_480 | photo_960 | photo_1920 | photo_download
object_key
format
content_type
width
height
bytes
etag
verified
```

### Active state

```text
media_id
active_revision_id
updated_at
```

不存在 server-side “uploaded waiting review” 状态要求；未发布照片的审核状态仍由本地队列承担。

## 18. OSS 对象结构

基础：

```text
media/albums/{albumId}/photos/{mediaId}/
  480.webp
  960.webp
  1920.webp
  original.{ext}
```

修图：

```text
media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/
  480.webp
  960.webp
  1920.webp
  download.{ext}
```

全部不可变。

## 19. API 设计

### 首次发布

现有：

```text
POST /api/v1/uploads
...对象 sign/complete...
POST /api/v1/media/:mediaId/publish
```

有本地 edit 时，在 publish 前增加 edit revision 创建与四对象 complete。

建议让 `/publish` 请求携带或服务端读取 `initialActiveRevisionId`，并在同一发布事务里完成：

```text
verify base complete
verify edit complete（如有）
set initial active revision（如有）
publish
assign publishSequence
outbox media.published
```

避免先 publish base、再 Apply edit 的竞态。

### 发布后修图

```text
POST /api/v1/media/:mediaId/edits
POST .../sign
POST .../complete
POST /api/v1/media/:mediaId/edits/:revisionId/apply
POST /api/v1/media/:mediaId/edits/revert
```

Apply 只允许完整 `ready` revision。

## 20. UI

修图入口：

1. 本地审核队列卡片；
2. 已发布媒体管理/审核界面。

两处共享同一个：

```text
PhotoEditor
SourceResolver
Recipe
LocalPhotoEditRuntime
ModelLoader
```

编辑器：

```text
照片处理
[ 智能优化 ]
曝光
色温 / 色调
高光
阴影
对比度
自然饱和度
饱和度
锐化

AI 修复
[ AI 降噪 ]
[ AI 清晰化 ]

本机处理 · 图片不会发送至 AI 服务
```

Before/After：

- 按住查看真正原始版本；
- 支持拖动分割线；
- 已发布媒体可切换原始/当前/历史 revision。

发布按钮进入 `uploading` 后显示完整上传进度。若本次有 edit，应明确包含“基础版本 + 修图版本”上传进度。

## 21. 本地源保留

发布完成后不能因为远端已有对象就立即删除 `originalBlob`。

允许清理的情况：

- 用户明确清理本地已完成文件；
- 浏览器存储压力；
- 本地队列生命周期结束；
- 数据损坏。

清理时应提示：以后仍可修图，但需要重新读取远端真正原图，会产生网络流量。

## 22. OCR 与人脸找图

A+B 不改变 Media 身份：

- 不重新跑号码 OCR；
- OCR/人工确认结果继续绑定 Media；
- 不重新建立人脸索引；
- 人脸搜索得到 mediaId 后显示当前 active revision。

首次发布时，即使公开版本为 edit，人脸索引仍按现有设计使用基础 `photo_1920`，避免改变既有供应商处理边界。

## 23. 费用边界

A+B：

- 云 AI 推理：0；
- 服务器 GPU：0；
- 上传流量：按 OSS 当前规则处理；
- 新增主要成本：edit 对象存储、请求与观众下载流量。

上传前应用修图时，每张至少：

```text
4 base objects + 4 edit objects
```

只要本地 originalBlob 存在，修图本身不得产生照片源 CDN GET。

## 24. 测试重点

### Case A：本地待审核修图

```text
选择照片
→ LocalReviewPhoto(local)
→ 修图并应用
→ 不产生照片源网络请求
→ 刷新后 recipe 恢复
```

### Case B：未修图发布

```text
local
→ 点击发布
→ uploading
→ base 4 objects 全部完成
→ publish
→ published
```

### Case C：上传前已修图发布

```text
local + applied_local
→ 点击发布
→ freeze snapshot
→ base 4 完整上传
→ edit 4 完整上传
→ initial active edit + publish 原子提交
→ published
→ 观众首次看到 edit
```

断言：不存在 base 短暂公开，也不存在发布后继续补 base original/edit download。

### Case D：发布失败

```text
uploading
→ failure
→ failed
→ 本地原图/recipe 保留
→ 调整或直接 retry
```

### Case E：发布后本地源仍在

```text
published
→ 再次修图
→ local originalBlob 命中
→ 无远端 original GET
→ 新 edit 4 objects 全部 ready
→ apply
→ media.updated
```

### Case F：本地源已清理

```text
published
→ local source missing
→ remote base photo_original fallback
→ 新 revision
```

### Case G：新 revision 失败

旧 active revision 必须始终保持可用，不能切换到半完成版本。

## 25. 实施顺序

### Phase 0

- 本地 edit draft store；
- SourceResolver；
- edit DB schema/migration；
- edit contracts/API；
- initial active edit 与 publish 原子集成；
- 公共 active variant/download resolver；
- 本地源保留策略。

### Phase 1

- A analysis/recipe/renderer；
- 上传前编辑器；
- 已发布编辑器；
- Before/After；
- full-resolution export；
- 批量智能优化/同步参数。

### Phase 2

- B 自托管模型；
- ONNX Runtime Web/WebGPU；
- denoise/deblur；
- tile；
- progress/cancel/error isolation；
- 模型版本记录。

### Phase 3

- 批量 AI 队列；
- 网络/GPU 资源调度；
- 历史 revision 管理；
- 存储统计与清理；
- 生产环境调参。

## 26. 固定实施决策

1. A+B 均不使用云 AI。
2. 待审核照片只存在本地队列；不存在稳定的“已上传但待审核”状态。
3. 点击发布就是审核通过、上传全部要求对象并最终公开。
4. `local` 状态可以完整修图。
5. 发布点击时冻结本次发布 snapshot，避免上传过程中 recipe 竞态。
6. 无修图首次发布：基础 4 对象全部完成后才 `/publish`。
7. 有修图首次发布：基础 4 + edit 4 全部完成后才 `/publish`。
8. 首次 active edit 与 publish 必须原子一致，禁止短暂公开 base。
9. `failed` 保留本地源和 recipe，可调整后重试。
10. `published` 后继续可修图；新 revision 四对象全部 ready 后才 Apply。
11. 任何阶段只要本地完整源存在，就禁止为了修图重新读取 CDN/OSS 原图。
12. 真正 `photo_original` 永不覆盖，始终作为管理端原始恢复源。
13. active edit 时观众最高质量下载指向 edit `photo_download`。
14. 已发布媒体 Apply/Revert 只发 `media.updated`，不改变发布时间或排序。
15. 模型自托管、懒加载、版本化，直接按生产路径接入并在当前生产环境调参。
