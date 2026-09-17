# 管理端本地智能修图

状态：已批准实施计划；直接接入生产代码路径，并在当前未对外投产的生产环境中验证、调参与迭代
更新日期：2026-09-17

## 1. 目标与固定边界

PhotoStream 管理端增加一套完全在浏览器本机运行的非破坏性照片优化能力，用于学校活动照片审核与快速修正。修图能力与上传状态解耦：**照片一进入本地队列即可修图，上传中、上传完成、发布后仍可继续使用同一套修图能力。**

功能分为两类：

- **A：智能自动优化**：曝光、白平衡、高光、阴影、对比度、自然饱和度、饱和度、基础锐化等确定性图像处理；不要求神经网络。
- **B：本地 AI 修复**：降噪、轻度清晰化/去模糊，以及由 A+B 组合得到的暗光增强；模型通过 ONNX Runtime Web 在管理端浏览器内执行，首选 WebGPU。

明确不进入本阶段：

- 云端 AI 或云端媒体处理；
- 换脸、瘦脸、大眼等改变人物结构的处理；
- 去路人、去物体、生成式补画、扩图、换背景、换天空；
- 基于生成模型重绘人物、衣物、号码牌、文字或场景；
- 默认对全部照片执行 AI；
- 默认超分辨率；
- 覆盖或修改真正上传的原始文件。

核心原则：**修复与优化，不生成新的事实性视觉内容。** 学校活动照片具有纪实属性，任何可能改变人物身份、文字、号码、服装或场景事实的生成式操作都不应混入普通“一键优化”。

本功能作为正常生产能力直接实现。由于 PhotoStream 当前尚未对外正式投产，不设置“独立 PoC → 验证门禁 → 再接入生产”的额外阶段；模型、参数、性能和视觉效果直接在生产代码路径与当前生产环境中验证、调整和迭代。

完整上传链路仍以[照片处理与上传链路](04-photo-pipeline.md)为准。本功能是与上传队列协作的独立编辑能力，但不要求照片先上传或先发布。

## 2. 固定设计原则

实现必须同时满足：

1. **任意上传阶段可编辑**：`local / uploading / uploaded / published` 状态都可以打开编辑器。
2. **零云 AI 推理费用**：A+B 不调用任何云 AI API，也不要求 PhotoStream 服务器配置 GPU。
3. **照片不发送给 AI 服务商**：推理数据只存在于管理员浏览器本机内存/GPU。
4. **本地源绝对优先**：只要该照片的完整上传源在当前设备可访问，就禁止为了修图再次从 CDN/OSS 下载同一源文件。
5. **双版本完整保留**：上传前已经应用修图，也必须完整上传基础原始版本的 `480/960/1920/original`，同时完整上传修图 revision 的 `480/960/1920/photo_download`；修图不得替代、跳过或覆盖基础归档链路。
6. **非破坏性**：真正上传的 `photo_original` 永不覆盖；编辑作为独立 revision 存在。
7. **当前版本一致**：观众看到的 480/960/1920 和“原图下载”都必须属于同一个 active revision。
8. **首次发布一致**：如果照片在首次发布前已经应用修图，观众第一次看到的就必须是修图版本，禁止先暴露未修图版本再切换。
9. **可回滚**：应用编辑只切换 active revision；恢复原始版本不重新编码真正原图。
10. **不阻塞未使用修图的照片**：没有应用修图的照片继续走现有上传/发布路径，不增加额外等待。
11. **故障隔离**：A/B 失败不得破坏上传队列、审核、发布、隐藏、精选、号码 OCR、人脸找图或普通浏览。
12. **适合高频审核**：绝大多数照片应通过“智能优化 → 应用”完成，不把管理端变成复杂专业修图软件。
13. **资源隔离**：AI 推理默认单并发、分块执行、可取消、失败隔离，不允许造成页面 OOM 或白屏。
14. **不可变对象**：编辑版本使用新的不可变 OSS object key，不覆盖已缓存对象。

## 3. 与现有本地照片队列的关系

现有 `LocalReviewPhoto` 已保存：

- `originalBlob`；
- 原始格式、Content-Type、宽高；
- 本地 480/960/1920 变体；
- `mediaId`（上传意图建立前可以为空）；
- 上传状态。

因此修图入口不应依赖 `mediaId` 是否已经存在，也不应依赖服务器是否已经有对象。照片进入队列、完成本地解码和基础派生后即可修图。

### 3.1 支持的四种状态

| 状态 | 是否可修图 | 主要数据源 | 应用后的行为 |
| --- | --- | --- | --- |
| `local` / 尚未上传 | 是 | 当前 File / `originalBlob` | 保存本地编辑草稿/本地已应用版本；上传开始后同步为服务端 revision |
| `uploading` | 是 | 本地源优先 | 可继续编辑；新的已应用版本成为首次发布目标或后续 active revision |
| `uploaded` / 未发布 | 是 | 本地源优先，远端仅 fallback | 若在发布前应用，首次发布直接使用该 edit revision |
| `published` | 是 | 本地源优先，远端仅 fallback | revision 就绪后通过 `media.updated` 切换当前版本，排序不变 |

这里的“上传后”不等于“改用远端源”。只要本地源还在，同一张已经上传甚至已经发布的照片仍然优先使用本地 `originalBlob`。

### 3.2 本地编辑草稿

在照片还没有 `mediaId` 时，不能创建服务端 revision，因此需要一个本地编辑草稿层。建议单独使用 IndexedDB store，例如：

```text
local-photo-edit-drafts
```

至少保存：

```text
localPhotoId
mediaId?                 // 上传开始后补齐
recipe
pipelineVersion
modelVersions
editState                // draft / applied_local / syncing / synced / failed
sourceFingerprint
updatedAt
```

原则：

- 保存 recipe、模型版本和必要状态，不长期保存 AI tensor；
- 可选缓存 960 级编辑预览，减少返回页面时重算；
- 全分辨率 `photo_download` 不要求长期持久化在 IndexedDB，可在真正需要同步/应用时从本地原图重新渲染；
- 页面刷新后，只要 `originalBlob` 和 recipe 仍在，就可以恢复编辑状态；
- `mediaId` 建立后，本地草稿自动绑定到对应 Media，而不是重新创建一套编辑体验。

### 3.3 本地源保留

上传完成不能成为自动删除 `originalBlob` 的理由。为了让“上传后仍可优先本地修图”成立：

- 上传完成后，本地审核队列记录和 `originalBlob` 应继续保留；
- 只有用户明确“清理已完成”、浏览器存储压力策略触发、队列生命周期结束或本地数据损坏时才允许丢失；
- 清理时 UI 应明确：清理后仍可远端修图，但会产生重新读取媒体的网络流量；
- 不承诺本地源永久存在；SourceResolver 必须支持本地缺失后的远端回退。

## 4. SourceResolver

所有修图入口——上传前、上传中、上传后、发布后——必须复用同一个 SourceResolver。

### 4.1 预览源优先级

```text
1. 当前内存中的本地处理结果 / 当前 File
2. IndexedDB LocalReviewPhoto.photo_1920
3. IndexedDB LocalReviewPhoto.photo_960
4. 本地编辑草稿缓存的预览
5. 当前浏览器已有的媒体 cache/blob cache
6. 远端 active/base 1920
7. 远端 active/base 960
```

### 4.2 最终全分辨率导出源优先级

```text
1. 当前 File
2. 当前内存中的完整 originalBlob
3. IndexedDB LocalReviewPhoto.originalBlob
4. 其他明确保存的本地全分辨率源
5. 仅 1–4 全部不存在时，才允许请求远端真正 photo_original
```

**只要 1–4 任一命中，不得创建 CDN/OSS 原图 GET。**

远端回退只用于：

- 管理员换了一台设备；
- 浏览器本地队列被清理；
- 用户主动清理已完成本地文件；
- 本地存储损坏或无法读取；
- 当前浏览器从未持有该照片原始文件。

应用编辑需要的是“最高质量可用源”，不是“必须重新从网络取得原图”。

## 5. 上传前、上传中与发布协作

### 5.1 上传前编辑

照片完成本地基础处理并进入队列后，立即可以：

```text
打开编辑器
→ A 智能优化 / 手动参数 / B AI 修复
→ Before/After
→ 应用
```

此时没有 `mediaId`，所以“应用”表示：

```text
local edit becomes desired active version
```

状态记为 `applied_local`。不需要等待网络，也不需要创建任何云端对象。

### 5.2 开始上传时同步本地编辑

如果上传开始时存在 `applied_local`，**基础上传链路和修图上传链路必须同时完整执行**。

基础版本必须完整上传：

```text
base photo_480
base photo_960
base photo_1920
base photo_original
```

修图版本另外完整上传：

```text
edit photo_480
edit photo_960
edit photo_1920
edit photo_download
```

也就是说，一张在上传前已经应用修图的照片最终至少保留 **8 个长期媒体对象**（不计历史 revision）。不得因为观众默认显示修图版，就省略基础 480/960/1920 或真正 `photo_original`；也不得用修图输出覆盖基础对象。

同步顺序：

1. 现有基础上传意图照常创建 Media，取得 `mediaId`；
2. 基础 `480/960/1920/original` 按原上传协议完整执行；
3. 将本地 edit draft 绑定到 `mediaId`；
4. 创建对应服务端 edit revision；
5. 直接从本地原图渲染并上传 edit 480/960；
6. edit 480/960 HEAD 验证后，该 revision 达到 `preview_ready`；
7. 将它设置为该 Media 的目标 active revision；
8. 首次发布时直接发布修图版；
9. edit 1920 / `photo_download` 继续生成和上传至 `ready`；
10. 基础上传即使此时尚未全部完成，也继续在后台补齐，直至四个基础对象完整。

**active revision 只决定观众看到哪个版本，不决定基础归档对象是否上传。**

### 5.3 禁止首次发布闪现未修图版

如果照片在首次发布前已经存在已应用本地编辑：

```text
base 480/960 ready
≠ 可以立即公开 base 版本
```

发布门禁必须知道该照片存在 `desired active edit`。只有 edit revision 的公开预览层已经可用并完成 active 绑定后，才允许该照片首次公开。

这条门禁只控制“公开哪个版本”，**不停止基础原图和基础派生图上传**。

没有应用编辑的照片完全不受此门禁影响，仍按现有 480/960 `preview_ready` 路径发布。

### 5.4 上传过程中继续修改

如果照片正在上传时管理员又修改 recipe：

- 基础 `480/960/1920/original` 上传继续进行，不重启、不取消；
- 不能覆盖已经上传的 edit revision 对象；
- 当前尚未公开的旧 revision 可以标记 superseded/discarded；
- 创建新的本地 draft/revision version；
- 以最后一次明确“应用”的版本作为 `desired active edit`；
- publication gate 只跟踪最新已应用版本；
- 已经产生的孤立 edit 对象进入可重试清理流程。

### 5.5 上传后/发布后编辑

上传完成以后，编辑器仍按同样流程工作：

```text
SourceResolver
→ 优先 local originalBlob
→ A/B
→ 新 revision
→ 上传 edit variants
→ Apply
```

基础 `480/960/1920/original` 已经存在，不受后续任何 edit revision 影响。如果媒体尚未发布，则新 revision 可以成为首次发布版本；如果媒体已经发布，则通过 `media.updated` 切换，不重新分配 `publishSequence`，不移动列表位置。

## 6. Edit revision 就绪层级

为了保持 PhotoStream 原有“小图先可用”的设计，edit revision 不必等待四个对象全部完成才允许成为当前浏览版本。

建议状态：

```text
draft
rendering
preview_ready
ready
applied
discarded
failed
```

其中：

- `preview_ready`：edit 480 + 960 已验证，可以作为首次发布/当前公共预览版本；
- `ready`：edit 1920 + `photo_download` 也已经验证；
- `applied`：该 revision 是当前 active revision；
- active revision 可以在 `preview_ready` 阶段先提供 480/960，1920 未完成时灯箱退到 edit 960；
- `photo_download` 未完成时隐藏/禁用当前版本最高质量下载入口，而不是回退暴露基础原图；
- edit revision 的阶段性就绪不改变“基础四对象必须最终完整上传”的要求。

## 7. 总体处理链路

```text
LocalReviewPhoto 创建
        │
        ├─ 可立即修图，尚未上传也可用
        │      ↓
        │   local edit draft / applied_local
        │
        └─ 上传开始 → 建立 mediaId
                       │
                       ├──────── 基础链路（始终完整）
                       │          base 480
                       │          base 960
                       │          base 1920
                       │          base original
                       │
                       └──────── 修图链路（若已应用 edit）
                                  edit 480
                                  edit 960
                                    ↓
                               preview_ready
                                    ↓
                              active + 首次发布
                                    ↓
                                  edit 1920
                                  edit download
                                    ↓
                                  ready

上传后/发布后再次修图：
本地源仍存在？
  ├─ 是 → 继续直接使用 local original
  └─ 否 → 才按需读取远端源
            ↓
        新 edit revision
            ↓
        media.updated 切换
```

照片二进制继续不经过香港 Fastify/Next.js/PostgreSQL。API 只负责 revision、上传能力、HEAD 校验、状态、审计和实时更新。

## 8. A：智能自动优化

### 8.1 分析输入

使用最长边约 512–768 px 的本地缩略分析图，至少计算：

- RGB/luminance histogram；
- P1/P5/P50/P95/P99；
- shadow/highlight clipping；
- 饱和度分布；
- 动态范围；
- 中性色候选；
- 基础清晰度分数；
- 基础噪声估计。

### 8.2 自动曝光

综合中位亮度、暗部裁切、高光裁切和 P5/P95 动态范围输出 `exposureEv`。自动值保持保守，初始限制约 `-1.2 EV ~ +1.2 EV`。

### 8.3 自动白平衡

使用鲁棒中性色/Gray-World 类方法，只从非过曝、非极暗、低到中等饱和度区域寻找中性色候选，输出 `temperature`、`tint` 和 confidence。舞台红光、蓝光、彩色灯光等低 confidence 场景不得被强行校正成中性。

### 8.4 高光、阴影与 Tone Curve

初始自动范围：

- `highlights`: 约 `-35 ~ +10`；
- `shadows`: 约 `-15 ~ +40`；
- 自动 contrast：约 `-15 ~ +15`。

目标是自然恢复，不追求明显 HDR 效果。

### 8.5 Vibrance / Saturation

智能优化优先调整 `vibrance`，对已经高饱和区域减少增益，并对典型肤色色相区域降低增强权重；这里不做人脸识别。

### 8.6 基础锐化

使用 Unsharp Mask 或等价高频增强算法。先以 Laplacian/Tenengrad 类指标估计清晰度，已经足够清晰的照片自动锐化应接近 0。

### 8.7 Edit Recipe

所有 A 操作归一为版本化 recipe：

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

效果应由“源图 + recipe + pipeline/model version”稳定重现，禁止反复对上一次 JPEG/WebP 结果继续编辑。

## 9. A 的渲染路径

### Preview

优先使用本地 960/1920；通过 WebGL2/WebGPU shader 或等价高性能路径实时展示曝光、白平衡、高光/阴影、曲线、饱和度和锐化。拖动 slider 不重新编码文件。

### Export

最终导出在 Dedicated Worker 中完成，避免阻塞 React 主线程。

## 10. B：本地 AI 修复

### 10.1 生产接入方式

B 直接作为正常生产代码能力实现，不设置独立 PoC 页面、实验分支或“PoC 通过后再接 production”的流程。

首选从 NAFNet 类非生成式图像恢复模型开始接入降噪和轻度去模糊；如果具体权重、ONNX 转换或 WebGPU 算子存在实际兼容问题，在正常开发过程中替换为功能等价、许可证允许且非生成式的恢复模型即可。

许可证核对、模型来源记录和依赖合规属于正常工程要求，不构成独立验证阶段。

### 10.2 Runtime

```text
Photo/Tile
  ↓
ONNX Runtime Web
  ↓
WebGPU Execution Provider
  ↓
Denoise / Deblur Model
  ↓
Tile Merge
  ↓
A Color Pipeline
  ↓
Export
```

WebGPU 不可用时 A 完整可用；B 显示当前设备不支持。首版不为了“必须支持所有设备”而让完整高分辨率模型强制走慢速 CPU fallback。

### 10.3 AI 降噪

首版优先维护一个降噪模型，通过原图与恢复结果混合调节强度：

```text
output = original * (1 - strength) + denoised * strength
```

UI 可提供轻/标准/强，也可进一步开放连续强度。

### 10.4 AI 清晰化

使用独立轻度去模糊恢复模型。不得由“一键智能优化”默认开启；管理员主动点击后运行，并通过 Before/After 确认。

### 10.5 暗光增强

```text
A：曝光 / 阴影 / 高光 / 白平衡
  ↓
B：AI 降噪
  ↓
A：最终 tone / 轻度锐化
```

不引入黑盒生成式夜景模型。

## 11. Tile 推理与资源管理

B 必须支持 tile inference，避免完整高分辨率图片一次性进入恢复网络造成 OOM。

初始参数可从：

- tile 256×256；
- overlap 32 px；
- reflect padding；
- weighted feathering；

开始，并直接在当前生产环境的目标浏览器/设备中根据实际表现调整。

### 11.1 自适应 Tile

允许 384 → 256 → 192 等有限降级。发生 allocation failure、OOM 或 WebGPU 限制时有限重试；最终失败只关闭当前 B 操作，不影响 A、上传或审核页。

### 11.2 并发

- A 分析允许有限并发；
- B inference 固定单并发；
- 不允许多张大图同时占用 GPU。

上传网络队列和 AI GPU 队列必须独立；AI 推理不能占用/暂停正常 PUT 并发控制。

### 11.3 资源释放

每个 tile 完成后及时释放 Tensor/GPU buffer；`ImageBitmap.close()`；释放临时 Canvas、Blob URL 和无用 ArrayBuffer。模型 Session 可在审核工作区内复用，离开或长时间 idle 后释放。

### 11.4 Device Lost

当前任务失败 → 释放旧 session → 最多重建一次 → 再失败则本次会话禁用 B。任何 AI 异常不得导致整个上传/审核页面崩溃。

## 12. 模型加载与缓存

模型按功能懒加载：

```text
看到队列/审核页 → 不加载 AI 模型
点击 AI 降噪 → 加载 denoise model
点击 AI 清晰化 → 加载 deblur model
```

修图入口可能出现在上传队列和审核工作区，但两处必须复用同一模型 loader/cache/runtime，不能重复下载模型。

生产模型全部由 PhotoStream 自托管，不允许运行时从 Hugging Face、GitHub Raw 或其他第三方 CDN 回退。

建议：

```text
/assets/models/photo-edit/
  {model-name}-{version}/
    model.onnx
    manifest.json
```

manifest 至少记录名称、版本、sha256、precision、默认 tile 和 overlap。模型 URL 使用版本/hash，不可变长缓存。

模型体积、tile 和性能参数直接根据当前生产环境实际结果调整，不设置单独 PoC 门槛。

## 13. 最终导出与全分辨率下载版本

### 13.1 `photo_download`

有 active edit 时，观众端“原图下载”必须拿到**修图后的最高质量版本**，不能继续返回真正上传的原始文件，也不能把 1920 浏览图冒充原图质量。

每个完整 edit revision 生成：

```text
photo_480
photo_960
photo_1920
photo_download
```

`photo_download` 尺寸保持处理源完整分辨率，不主动限制到 1920。

### 13.2 真正上传原图的角色

真正的 `photo_original`：

- **即使照片在上传前已经应用修图，也必须照常上传并长期保留**；
- 永不覆盖；
- active edit 存在时不再作为观众端“原图下载”目标；
- 仅保留给管理端恢复原始版本、Before/After、重新编辑和审计；
- active revision 被清除后，观众端下载重新解析到真正 `photo_original`。

### 13.3 Pipeline V1

```text
1. Resolve best local source first
2. Decode / Orientation
3. AI Denoise（可选，tile）
4. AI Deblur（可选，tile）
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

应尽量从同一次全分辨率编辑结果向下派生 1920/960/480，保证观众浏览图与下载图视觉一致。对于特别大的图片，允许内部采用分块/分阶段渲染降低峰值内存，但不能因为性能原因把 `photo_download` 降成 1920。

Pipeline 必须版本化，例如 `local-edit-v1`。

## 14. 非破坏性数据模型

### 14.1 `media_edit_revisions`

建议字段：

```text
id
media_id
created_by
status
pipeline_version
recipe_version
recipe_json
denoise_model
denoise_model_version
deblur_model
deblur_model_version
source_kind
source_etag
source_origin        // local / remote
created_at
preview_ready_at
ready_at
applied_at
failure_code
```

### 14.2 `media_edit_variants`

kind：

```text
photo_480
photo_960
photo_1920
photo_download
```

`photo_download` 是编辑后的全分辨率下载对象，不等于真正上传的 `photo_original`。

### 14.3 Active / desired revision

服务端至少需要表达：

```text
media_id
active_revision_id
updated_at
```

客户端本地还需要表达“尚未有 mediaId 但已经应用”的 `desired edit`。取得 mediaId 后自动同步为正式 revision。

对于尚未发布的 Media，如果 edit 已应用但服务器 revision 尚未达到 `preview_ready`，发布事务必须知道“存在 desired edit”，不能绕过它发布 base 版本；但基础四对象上传必须继续进行。

## 15. OSS 对象

一张没有修图的照片最终至少保留基础四对象：

```text
media/albums/{albumId}/photos/{mediaId}/
  480.webp
  960.webp
  1920.webp
  original.jpg
```

一张存在已保留 edit revision 的照片，在此基础上额外保留：

```text
media/albums/{albumId}/photos/{mediaId}/edits/{revisionId}/
  480.webp
  960.webp
  1920.webp
  download.{jpg|webp}
```

因此首次上传前已经应用修图时，正常目标是：

```text
4 个 base 对象 + 4 个 edit 对象 = 8 个对象
```

所有 revision 对象不可变，不覆盖基础 480/960/1920/original。

## 16. API 与本地同步

### 16.1 mediaId 尚不存在

不调用 edit API。全部操作保存在本地 edit draft。

### 16.2 mediaId 建立后创建 revision

```text
POST /api/v1/media/:mediaId/edits
```

请求包含 recipe 和 pipeline/model metadata。若浏览器已有本地完整源，API **不需要签发源文件 GET**，只提供 revision 与目标上传能力。基础 UploadIntent 仍完整维护四个 base 对象，edit API 不得把其标记为可省略。

### 16.3 Preview complete

建议允许独立确认 480/960：

```text
POST /api/v1/media/:mediaId/edits/:revisionId/preview-complete
```

服务端 HEAD 验证 edit 480/960，revision 进入 `preview_ready`。这一步支持首次发布直接使用修图版，而不必等待全分辨率下载对象。

### 16.4 完整 complete

```text
POST /api/v1/media/:mediaId/edits/:revisionId/complete
```

HEAD 校验 edit 1920/download，并将 revision 标为 `ready`。这不替代基础 UploadIntent 对 base 1920/original 的完成校验。

### 16.5 应用

```text
POST /api/v1/media/:mediaId/edits/:revisionId/apply
```

- 已发布媒体：切换 active revision，发送 `media.updated`；
- 未发布媒体：标记为首次发布应使用的 active revision；
- 如果 revision 只有 `preview_ready`，允许先提供 edit 480/960，edit 1920/download 稍后补齐；
- 无论 active edit 状态如何，基础四对象仍按基础上传协议补齐。

### 16.6 回退/切换

```text
POST /api/v1/media/:mediaId/edits/revert
```

可清除 active revision 恢复真正原始版本，或切换到指定历史 revision。

## 17. 公共媒体解析与下载语义

浏览尺寸：

```text
active edit 存在
  → edit 480/960/1920（尚未有 1920 时退到 edit 960）
否则
  → base 480/960/1920
```

“原图下载”解析：

```text
active edit 存在且 photo_download ready
  → active edit.photo_download
active edit 存在但 photo_download 尚未 ready
  → 暂时不提供最高质量下载
无 active edit
  → base photo_original
```

active edit 存在时**禁止**因为 edit download 尚未完成而回退给观众真正 `photo_original`，否则会造成“页面是修图版、下载却是未修图版”的版本错配。

基础四对象是否完整上传属于归档/回滚完整性；active revision 属于公开版本选择。两者必须分开建模。

应用修图后只发送 `media.updated` 或等价事件；不得重新 `media.published`、不得改变发布时间、不得让照片跳到列表顶部。

## 18. OCR 与人脸找图

A+B 不改变 Media 身份，因此：

- 不因普通修图重新运行号码 OCR；
- OCR 候选/人工确认继续绑定 Media；
- 不因普通修图重新建立人脸索引；
- 人脸找图先得到 mediaId，展示时解析 active revision。

上传前编辑也不改变 OCR 的基础媒体身份。号码 OCR 可以继续使用现有基础 1920 工作图；修图和 OCR 不互相阻塞。

## 19. 管理端 UI

修图入口必须同时存在于：

1. **上传/本地队列卡片**：照片一进入队列即可点“修图”；
2. **审核/媒体管理页**：上传完成后继续使用相同编辑器。

两处不能实现两套不同的编辑逻辑；应共享 `PhotoEditor`、recipe、SourceResolver、LocalPhotoEditRuntime 和模型缓存。

### 19.1 上传队列中的状态

队列卡片增加轻量状态：

```text
未修图
已修改（未应用）
已应用 · 本地
正在同步修图版本
修图版本已同步
修图同步失败
```

上传进度和修图状态是两个独立状态轴，不能压成一个枚举。对于上传前已应用修图的照片，上传详情应能分别显示：

```text
基础版本：480 / 960 / 1920 / 原图
修图版本：480 / 960 / 1920 / 最高质量
```

避免用户误以为“修图后只上传修图版”。

### 19.2 编辑器

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

### 19.3 Before/After

- 按住查看真正原始版本；
- 大图编辑器提供拖动分割线；
- 若当前照片已有历史 revision，允许在“原始 / 当前 / 历史 revision”之间切换。

### 19.4 AI 状态

首次加载模型显示下载/准备进度；推理显示本地进度。失败只影响照片处理区，不产生全局错误页，也不暂停正在进行的基础上传。

## 20. 批量工作流

### A 批量智能优化

上传前队列和上传后审核页都允许选中多张执行。每张独立分析、独立 recipe。

### 同步参数

对同机位/同光线连续照片允许把当前 A recipe 同步到选中照片。

### B Batch

可直接纳入正常生产实现，但保持队列式执行和 `AI concurrency = 1`。上传网络任务和 AI 推理任务独立调度。

## 21. 本地任务 Runtime

建立独立 `LocalPhotoEditRuntime`：

```text
idle
loading_model
analyzing
processing
rendering
sync_pending
uploading_edit
preview_ready
ready
failed
cancelled
```

复用现有 IndexedDB、任务恢复、失败重试和资源压力设计经验，但基础上传任务与编辑任务隔离。edit upload 失败不能把已经完成的 base upload 回滚；base upload 失败也不能删除本地 edit recipe。

编辑任务记录/暴露：

```text
sourceOrigin = local-file | local-original | local-variant | cache | remote-original | remote-variant
```

便于调试“为什么产生了网络读取”。

## 22. 本地源与网络读取审计

必须增加可观察性：

- source resolver 明确返回 source 类型；
- 浏览器调试日志记录 source 类型，但不记录签名 URL；
- 本地 `originalBlob` 存在时，测试断言不会请求远端 original；
- **未上传照片修图时网络面板不得出现任何照片源 GET**；
- 已上传照片只要本地源存在，同样不得出现原图 GET；
- 首次 B 使用可以出现模型加载；
- 同步 edit 时只出现 edit PUT、complete/apply 等必要请求；
- 对上传前已应用 edit 的照片，必须能观察到 base 四对象和 edit 四对象都完成上传；
- 换设备/清本地数据的测试才允许出现远端源 GET。

## 23. 安全、隐私与日志

推理数据流：

```text
本地文件或 PhotoStream 自有媒体
  → 已认证管理端浏览器
  → 本机内存/GPU
```

禁止 `browser → third-party AI provider`。

错误日志仅允许 pipeline/model version、backend、tile size、图片尺寸、sourceOrigin、error code、elapsed time；不得记录 Blob/base64、人脸 crop、tensor 或长期签名 URL。

## 24. 费用边界

A+B 不产生 AI 推理账单，不需要服务器 GPU。

一张上传前已经应用修图且保留一个 edit revision 的照片，正常会上传并长期保留：

```text
base: 480 + 960 + 1920 + original
edit: 480 + 960 + 1920 + photo_download
= 8 个媒体对象
```

允许新增成本：

- 自托管模型静态文件；
- edit revision 的四个额外对象；
- 双版本长期存储容量；
- 仅当本地完整源不存在时，管理端按需读取远端源产生的普通媒体流量/请求。

照片上传前或上传后只要 `originalBlob` 仍在本地，修图都不应产生照片源 CDN 流量。

继续禁止云 AI、云图片修复/超分/生成、函数计算 AI 和新增付费视觉服务。

## 25. 生产环境中的验证与调参方式

不设独立模型 PoC 阶段。实现完成后直接部署到当前生产环境，由管理员在正式对外投产前使用真实工作流验证并调整：

- 上传前修图；
- 上传前应用 edit 后，base 四对象和 edit 四对象均完整上传；
- 上传过程中修改/重新应用；
- 上传后本地源仍存在时的零远端读取；
- 清理本地源后的远端 fallback；
- 模型大小与首次加载体验；
- WebGPU 兼容；
- tile/overlap；
- 960/1920/full-resolution 处理耗时；
- 峰值内存/显存；
- 降噪/去模糊强度；
- A 自动参数范围；
- 舞台灯光、暗光、运动、合影、号码牌/文字等实际照片效果。

这些是生产环境内的正常调参与缺陷修正，不是“通过后才允许接入生产”的资格门禁。

## 26. 性能与质量目标

A：

- 960 slider 接近实时；
- 自动分析优先争取 `< 300 ms`；
- 常规 1920 确定性渲染优先争取 `< 2 s`。

B：

- 960 目标数秒级；
- 1920 优先争取约 10 秒量级以内；
- full-resolution 下载版允许更慢，但 UI 必须持续反馈进度且可取消；
- UI 不冻结；
- 单张失败不影响下一张；
- 修图运行时不得明显拖慢正在进行的上传网络任务。

质量重点：不能出现蜡像脸、错误文字/号码、明显 halo、错误纹理或大面积涂抹感。若出现则直接在当前生产环境调整模型/参数。

## 27. 测试计划

建议新增：

```text
photo-edit-analysis.test.ts
photo-edit-recipe.test.ts
photo-edit-pipeline.test.ts
photo-edit-source-resolver.test.ts
photo-edit-local-draft.test.ts
photo-edit-upload-sync.test.ts
photo-edit-tiling.test.ts
photo-edit-model-runtime.test.ts
```

E2E 至少覆盖：

### Case A：尚未上传

```text
选择照片
→ LocalReviewPhoto 创建
→ 不开始上传
→ 打开修图
→ 智能优化 / AI 修复
→ 应用
→ 刷新页面仍恢复 recipe
→ 断言没有照片源网络 GET
```

### Case B：修图后开始上传

```text
applied_local edit
→ 开始上传
→ 建立 mediaId
→ base 480/960/1920/original 全部上传
→ edit 480/960/1920/download 全部上传
→ edit 480/960 preview_ready 后首次发布直接显示修图版
→ 从未公开 base 未修图版
→ 最终断言 8 个预期对象全部 verified
```

### Case C：上传过程中修图

```text
base upload in progress
→ 打开编辑器
→ 应用 edit
→ base upload 不取消
→ desired active revision 更新
→ publication gate 使用最新 edit
→ 两套对象最终各自完整
```

### Case D：上传/发布后，本地源仍在

```text
media uploaded/published
→ originalBlob 仍在 IndexedDB
→ 再次修图
→ 断言无远端 original GET
→ new revision
→ media.updated
→ 排序不变
```

### Case E：本地源已清理

```text
清理本地队列
→ 打开已上传照片编辑器
→ SourceResolver fallback remote
→ 允许一次远端源读取
→ 后续编辑正常
```

### Case F：下载语义

```text
active edit
→ viewer 原图下载解析到 edit photo_download
→ edit download 未 ready 时入口暂不可用
→ 不得 fallback base original
→ revert
→ viewer 恢复 base original
```

还需覆盖 WebGPU 不可用、inference OOM/device lost、模型加载失败、edit upload 部分失败、base upload 部分失败、apply 并发冲突、刷新后的 local/synced 状态恢复和孤立 revision 清理。

## 28. 预计代码区域

```text
apps/web/src/lib/photo-edit/
  source-resolver.ts
  local-edit-drafts.ts
  upload-sync.ts
  analysis.ts
  recipe.ts
  renderer.ts
  model-runtime.ts
  tiling.ts
  model-manifest.ts

apps/web/src/workers/
  photo-edit.worker.ts

apps/web/src/components/upload/
  photo-edit-entry.tsx

apps/web/src/components/review/
  photo-editor.tsx
  photo-edit-controls.tsx
  before-after-view.tsx

apps/api/src/.../
  photo-edit routes/service

packages/contracts/src/.../
  photo-edit contracts

packages/db/src/.../
  edit revision/state schema
```

同时修改本地 review queue、上传状态同步、公共 variant/download resolver、SSE/media update、migration、API 路由、测试和 E2E。

## 29. 实施顺序

不设置独立 PoC 阶段，按正常生产功能直接推进。

### Phase 0：本地编辑草稿 + SourceResolver + 服务端 revision 基础设施

- 本地 edit draft store；
- 上传前编辑入口；
- SourceResolver，本地原图优先；
- DB schema/migration；
- contracts；
- `media_edit_revisions` / `media_edit_variants` / active revision；
- local draft → media revision 同步；
- base 四对象与 edit 四对象并行但独立的完整上传状态；
- preview_ready 与 complete；
- 公共浏览与下载解析；
- 首次发布门禁与实时更新。

### Phase 1：A 智能调色直接接入

- analysis；
- versioned recipe；
- preview renderer；
- full-resolution export worker；
- 上传队列 + 审核页共享 editor UI；
- Before/After；
- Reset；
- 批量智能优化与同步参数。

### Phase 2：B 本地 AI 直接接入生产代码

- 自托管模型；
- ONNX Runtime Web / WebGPU；
- denoise；
- deblur；
- tile；
- progress/cancel/retry；
- device lost/OOM 隔离；
- 强度混合；
- full-resolution download 输出；
- 模型版本记录。

完成后直接部署当前生产环境进行真实调参，不经过另一个 PoC promotion 阶段。

### Phase 3：效率与生产调优

- AI Batch Queue；
- 快捷操作；
- source/network 可观察性；
- 上传与修图并行时的资源调度；
- 根据生产环境实际照片和设备调整 A 参数、模型版本、tile、强度和缓存策略。

## 30. 首版功能清单

### 上传生命周期

- 照片进入本地队列后立即可修图；
- 未上传也能完整使用 A/B；
- 上传中仍可修改和重新应用；
- 上传后/发布后继续可修图；
- 四个阶段统一优先本地源；
- 上传前应用的修图版本可作为首次公开版本；
- 上传前已应用修图仍必须完整上传 base 四对象 + edit 四对象；
- 禁止首次公开时短暂显示未修图 base 版本。

### A

- 一键智能优化；
- 曝光；
- 色温/色调；
- 高光；
- 阴影；
- 对比度；
- 自然饱和度；
- 饱和度；
- 锐化；
- Before/After；
- Reset；
- 非破坏性 revision；
- Apply/Revert；
- 批量智能优化；
- 同步参数。

### B

- 本地 AI 降噪；
- 本地 AI 清晰化；
- A+B 暗光增强；
- WebGPU；
- tile inference；
- 自托管模型缓存；
- 强度调节；
- Cancel/Retry；
- 设备兼容/失败隔离。

### 下载与版本

- active edit 的 480/960/1920；
- active edit 的全分辨率 `photo_download`；
- 观众“原图下载”始终下载当前 active 版本的最高质量结果；
- 真正 `photo_original` 只保留用于管理端恢复原始版本/重新编辑；
- 本地完整源存在时禁止重复远端获取。

### 暂缓

- AI 去路人/物体；
- Generative Fill；
- 换背景/天空；
- 人脸结构美化；
- 云 AI；
- 默认超分辨率。

## 31. 固定实施决策

下一步编码按以下决策执行，无需再次讨论基础方向：

1. A+B 均不使用云 AI。
2. **照片进入本地队列后即可修图，不要求上传开始、上传完成或发布。**
3. 上传中、上传后、发布后继续使用同一套编辑器和同一套 recipe/revision 机制。
4. B 不设独立 PoC/验证阶段，直接作为生产代码能力接入；当前生产环境用于正式投产前的验证和调参。
5. 只要当前设备有完整本地上传源，就禁止为了修图从 CDN/OSS 重新获取原图，与照片是否已经上传无关。
6. 现有 `LocalReviewPhoto.originalBlob` 是同设备编辑时的首选最终导出源；上传完成后不得无条件立即清理。
7. mediaId 尚不存在时，编辑以本地 draft/applied_local 保存；mediaId 建立后自动同步为服务端 revision。
8. **上传前即使已经应用修图，也必须完整上传基础 `480/960/1920/original`，并额外完整上传修图 `480/960/1920/photo_download`。**
9. 如果首次发布前已经应用修图，首次公开必须直接使用修图版本，禁止先公开 base 版本再切换；这不影响基础四对象继续后台补齐。
10. 真正上传的 `photo_original` 永不覆盖，只用于管理端恢复/重新编辑和无 active edit 时的公共最高质量下载。
11. 每个 edit revision 生成 `photo_480`、`photo_960`、`photo_1920` 和全分辨率 `photo_download`。
12. active edit 存在时，观众端“原图下载”必须解析到该 revision 的 `photo_download`；尚未 ready 时暂时不提供，不能回退 base `photo_original`。
13. 编辑版本使用独立 revision 和不可变 OSS key。
14. 公共端只感知当前 active 版本，不需要理解编辑器内部历史结构。
15. WebGPU 是 B 首选执行后端；缺少 WebGPU 时 A 仍完整可用。
16. AI 推理单并发、可取消、失败隔离；上传网络队列与 AI GPU 队列互不阻塞。
17. 模型只自托管、懒加载、长缓存，不使用第三方运行时模型 CDN。
18. 已发布媒体应用编辑只发媒体更新，不重新发布时间、不改变列表排序。
19. OCR 与人脸结果继续绑定 Media，不因普通修图重新计算。
20. 所有模型/参数变化通过明确 model/pipeline version 记录，允许在当前生产环境持续调整而不破坏旧 revision。

第一轮代码工作从 **Phase 0 → Phase 1 → Phase 2** 连续推进；不再插入独立模型 PoC 阶段。