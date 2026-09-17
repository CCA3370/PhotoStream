# 管理端本地智能修图

状态：已批准实施计划；直接接入生产代码路径，并在当前未对外投产的生产环境中验证、调参与迭代
更新日期：2026-09-17

## 1. 目标与固定边界

PhotoStream 管理端增加一套完全在浏览器本机运行的非破坏性照片优化能力，用于学校活动照片审核与快速修正。该能力不进入上传主链路，不依赖云端 AI、服务器 GPU、函数计算或第三方推理服务。

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

本功能作为正常生产能力直接实现。由于 PhotoStream 当前本身尚未对外正式投产，不设置“独立 PoC → 验证门禁 → 再接入生产”的额外阶段；模型、参数、性能和视觉效果直接在生产代码路径与当前生产环境中验证、调整和迭代。

完整上传链路仍以[照片处理与上传链路](04-photo-pipeline.md)为准；本功能是审核阶段的独立编辑能力。

## 2. 固定设计原则

实现必须同时满足：

1. **零云 AI 推理费用**：A+B 不调用任何云 AI API，也不要求 PhotoStream 服务器配置 GPU。
2. **照片不发送给 AI 服务商**：推理数据只存在于管理员浏览器本机内存/GPU。
3. **本地源优先**：只要该照片的完整上传源在当前设备可访问，就禁止为了修图再次从 CDN/OSS 下载同一源文件。
4. **非破坏性**：真正上传的 `photo_original` 永不覆盖；编辑作为独立 revision 存在。
5. **当前版本一致**：观众看到的 480/960/1920 和“原图下载”都必须属于同一个 active revision。
6. **可回滚**：应用编辑只切换 active revision；恢复原始版本不重新编码真正原图。
7. **不阻塞上传与发布**：A/B 失败不得影响上传、审核、发布、隐藏、精选、号码 OCR、人脸找图或普通浏览。
8. **适合高频审核**：绝大多数照片应通过“智能优化 → 应用”完成，不把管理端变成复杂专业修图软件。
9. **资源隔离**：AI 推理默认单并发、分块执行、可取消、失败隔离，不允许造成审核页 OOM 或白屏。
10. **不可变对象**：编辑版本使用新的不可变 OSS object key，不覆盖已缓存对象。

## 3. 与现有本地照片队列的关系

现有 `LocalReviewPhoto` 已保存：

- `originalBlob`；
- 原始格式、Content-Type、宽高；
- 本地 480/960/1920 变体；
- `mediaId` 与上传状态。

因此，在上传照片的同一设备上，只要该 IndexedDB 本地记录仍存在，编辑器应直接使用本地 `originalBlob` 和本地预览变体。

### 3.1 SourceResolver 固定优先级

预览源：

```text
1. 当前内存中的本地处理结果
2. IndexedDB LocalReviewPhoto.photo_1920
3. IndexedDB LocalReviewPhoto.photo_960
4. 当前浏览器已有的媒体缓存/blob cache
5. 远端 active/base 1920
6. 远端 active/base 960
```

最终全分辨率导出源：

```text
1. 当前 File / 本地 originalBlob
2. IndexedDB LocalReviewPhoto.originalBlob
3. 其他已明确保存的本地全分辨率源
4. 仅当前三项都不存在时，才允许请求远端真正 photo_original
```

**只要 1–3 任一命中，不得创建 CDN/OSS 原图 GET。**

远端回退只用于以下情况：

- 管理员换了一台设备；
- 浏览器本地队列被清理；
- 管理员主动删除了该照片的本地记录；
- 本地存储损坏或无法读取。

上一版“应用最终编辑时优先下载一次原图”的描述废止。应用编辑需要的是“最高质量可用源”，而不是“必须重新从网络取得原图”。

## 4. 总体处理链路

```text
本地照片可用？
  ├─ 是 → 直接读取本地 originalBlob / 本地 variants
  └─ 否 → 按需读取远端媒体
            │
            ▼
管理端编辑器
  ├─ A：本地分析 + 确定性调色
  └─ B：ONNX Runtime Web + WebGPU 本地恢复
            │
            ▼
浏览器生成当前 revision：
  photo_480
  photo_960
  photo_1920
  photo_download（全分辨率修图版）
            │
            ▼
直接上传 OSS 新对象
            │
            ▼
API HEAD 校验并标记 ready
            │
            ▼
Apply → active revision 切换
            │
            ▼
观众端所有尺寸与下载统一解析到 active revision
```

照片二进制继续不经过香港 Fastify/Next.js/PostgreSQL。API 只负责 revision、短期对象能力、HEAD 校验、状态、审计和实时更新。

## 5. A：智能自动优化

### 5.1 分析输入

为避免对完整大图执行不必要统计，分析阶段使用最长边约 512–768 px 的本地缩略分析图。分析图只存在本机内存。

至少计算：

- RGB/luminance histogram；
- P1/P5/P50/P95/P99；
- shadow/highlight clipping；
- 饱和度分布；
- 动态范围；
- 中性色候选；
- 基础清晰度分数；
- 基础噪声估计。

### 5.2 自动曝光

综合中位亮度、暗部裁切、高光裁切和 P5/P95 动态范围输出 `exposureEv`。自动值保持保守，初始限制约 `-1.2 EV ~ +1.2 EV`。

### 5.3 自动白平衡

使用鲁棒中性色/Gray-World 类方法，只从非过曝、非极暗、低到中等饱和度区域寻找中性色候选，输出 `temperature`、`tint` 和 confidence。

舞台红光、蓝光、彩色灯光等低 confidence 场景不得被强行校正成中性。

### 5.4 高光、阴影与 Tone Curve

初始自动范围：

- `highlights`: 约 `-35 ~ +10`；
- `shadows`: 约 `-15 ~ +40`；
- 自动 contrast 建议约 `-15 ~ +15`。

目标是自然恢复，不追求明显 HDR 效果。

### 5.5 Vibrance / Saturation

智能优化优先调整 `vibrance`，对已经高饱和区域减少增益，并对典型肤色色相区域降低增强权重；这里不做人脸识别。

### 5.6 基础锐化

使用 Unsharp Mask 或等价高频增强算法。先以 Laplacian/Tenengrad 类指标估计清晰度，已经足够清晰的照片自动锐化应接近 0。

### 5.7 Edit Recipe

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

## 6. A 的渲染路径

### Preview

优先使用本地 960/1920；通过 WebGL2/WebGPU shader 或等价高性能路径实时展示曝光、白平衡、高光/阴影、曲线、饱和度和锐化。拖动 slider 不重新编码文件。

### Export

最终导出在 Dedicated Worker 中完成，避免阻塞 React 主线程。

## 7. B：本地 AI 修复

### 7.1 生产接入方式

B 直接作为正常生产代码能力实现，不设置独立 PoC 页面、实验分支或“PoC 通过后再接 production”的流程。

首选从 NAFNet 类非生成式图像恢复模型开始接入降噪和轻度去模糊；如果具体权重、ONNX 转换或 WebGPU 算子存在实际兼容问题，在正常开发过程中替换为功能等价、许可证允许且非生成式的恢复模型即可。

许可证核对、模型来源记录和依赖合规属于正常工程要求，不构成独立验证阶段。

### 7.2 Runtime

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

WebGPU 不可用时 A 完整可用；B 显示当前设备不支持。首版不为了“必须支持所有设备”而让完整 1920/全分辨率模型强制走慢速 CPU fallback。

### 7.3 AI 降噪

首版优先维护一个降噪模型，通过原图与恢复结果混合调节强度：

```text
output = original * (1 - strength) + denoised * strength
```

UI 可提供轻/标准/强，也可进一步开放连续强度。

### 7.4 AI 清晰化

使用独立轻度去模糊恢复模型。不得由“一键智能优化”默认开启；管理员主动点击后运行，并通过 Before/After 确认。

### 7.5 暗光增强

组合管线：

```text
A：曝光 / 阴影 / 高光 / 白平衡
  ↓
B：AI 降噪
  ↓
A：最终 tone / 轻度锐化
```

不引入黑盒生成式夜景模型。

## 8. Tile 推理与资源管理

B 必须支持 tile inference，避免完整高分辨率图片一次性进入恢复网络造成 OOM。

初始参数可从：

- tile 256×256；
- overlap 32 px；
- reflect padding；
- weighted feathering；

开始，并直接在当前生产环境的目标浏览器/设备中根据实际表现调整。

### 8.1 自适应 Tile

允许 384 → 256 → 192 等有限降级。发生 allocation failure、OOM 或 WebGPU 限制时有限重试；最终失败只关闭当前 B 操作，不影响 A 或审核页。

### 8.2 并发

- A 分析允许有限并发；
- B inference 固定单并发；
- 不允许多张大图同时占用 GPU。

### 8.3 资源释放

每个 tile 完成后及时释放 Tensor/GPU buffer；`ImageBitmap.close()`；释放临时 Canvas、Blob URL 和无用 ArrayBuffer。模型 Session 可在审核工作区内复用，离开或长时间 idle 后释放。

### 8.4 Device Lost

当前任务失败 → 释放旧 session → 最多重建一次 → 再失败则本次会话禁用 B。任何 AI 异常不得导致整个审核页崩溃。

## 9. 模型加载与缓存

模型按功能懒加载：

```text
进入审核页 → 不加载 AI 模型
点击 AI 降噪 → 加载 denoise model
点击 AI 清晰化 → 加载 deblur model
```

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

## 10. 最终导出与全分辨率下载版本

### 10.1 为什么需要 `photo_download`

有 active edit 时，观众端“原图下载”必须拿到**修图后的最高质量版本**，不能继续返回真正上传的原始文件，也不能把 1920 浏览图冒充原图质量。

因此每个完整 edit revision 除 480/960/1920 外，再生成：

```text
photo_download
```

其尺寸保持处理源的完整分辨率（不主动限制到 1920），用于当前修图版本的最高质量下载。

### 10.2 真正上传原图的角色

真正的 `photo_original`：

- 永不覆盖；
- active edit 存在时不再作为观众端“原图下载”目标；
- 仅保留给管理端恢复原始版本、Before/After、重新编辑和审计；
- active revision 被清除后，观众端下载重新解析到真正 `photo_original`。

### 10.3 Pipeline V1

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

应尽量从同一次全分辨率编辑结果向下派生 1920/960/480，保证观众浏览图与下载图视觉一致。

对于特别大的图片，允许内部采用分块/分阶段渲染降低峰值内存，但不能因为性能原因偷偷把 `photo_download` 降成 1920。

Pipeline 必须版本化，例如 `local-edit-v1`。

## 11. 非破坏性数据模型

### 11.1 `media_edit_revisions`

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
ready_at
applied_at
failure_code
```

状态：`draft / rendering / ready / applied / discarded / failed`。

### 11.2 `media_edit_variants`

kind：

```text
photo_480
photo_960
photo_1920
photo_download
```

`photo_download` 是编辑后的全分辨率下载对象，不等于真正上传的 `photo_original`。

### 11.3 Active Revision

使用 `media_edit_state` 或等价结构保存：

```text
media_id
active_revision_id
updated_at
```

切换 active revision 不删除任何基础原图，也不重新编码。

## 12. OSS 对象

建议：

```text
media/albums/{albumId}/photos/{mediaId}/
  480.webp
  960.webp
  1920.webp
  original.jpg
  edits/
    {revisionId}/
      480.webp
      960.webp
      1920.webp
      download.{jpg|webp}
```

所有 revision 对象不可变，不覆盖基础 480/960/1920/original。

## 13. API

### 创建 revision

```text
POST /api/v1/media/:mediaId/edits
```

请求包含 recipe 和 pipeline/model metadata。若浏览器已有本地完整源，API **不需要签发源文件 GET**，只提供 revision 与四个目标上传能力；只有 SourceResolver 明确确认本地完整源不存在时，客户端才请求远端源能力。

### 完成上传

```text
POST /api/v1/media/:mediaId/edits/:revisionId/complete
```

HEAD 校验 480/960/1920/download 四个对象的 bytes、content-type、尺寸/元数据与 etag。

### 应用

```text
POST /api/v1/media/:mediaId/edits/:revisionId/apply
```

只允许 `ready` revision 成为 active；发送媒体更新事件，不改变发布时间。

### 回退/切换

```text
POST /api/v1/media/:mediaId/edits/revert
```

可清除 active revision 恢复真正原始版本，或切换到指定历史 revision。

## 14. 公共媒体解析与下载语义

公共照片 API 继续向观众端提供当前有效 variants，而不暴露内部 revision 结构。

浏览尺寸：

```text
active edit 存在
  → edit 480/960/1920
否则
  → base 480/960/1920
```

“原图下载”解析：

```text
active edit 存在
  → active edit.photo_download
否则
  → base photo_original
```

因此观众端“原图”语义调整为：**当前照片版本的最高质量下载**，而不是永远等于相机上传的字节原件。

真正上传原图只对管理端保留，用于切回原始版本和重新编辑。active edit 存在时不得通过普通观众下载流程暴露真正原始对象。

应用修图后只发送 `media.updated` 或等价事件；不得重新 `media.published`、不得改变发布时间、不得让照片跳到列表顶部。

## 15. OCR 与人脸找图

A+B 不改变 Media 身份，因此：

- 不因普通修图重新运行号码 OCR；
- OCR 候选/人工确认继续绑定 Media；
- 不因普通修图重新建立人脸索引；
- 人脸找图先得到 mediaId，展示时解析 active revision。

## 16. 管理端 UI

审核 Inspector 增加：

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

### Before/After

- 按住查看真正原始版本；
- 大图编辑器提供拖动分割线；
- 若当前照片已有历史 revision，允许在“原始 / 当前 / 历史 revision”之间切换。

### AI 状态

首次加载模型显示下载/准备进度；推理显示本地进度。失败只影响照片处理区，不产生全局错误页。

## 17. 批量工作流

### A 批量智能优化

选中多张后每张独立分析、独立 recipe。

### 同步参数

对同机位/同光线连续照片允许把当前 A recipe 同步到选中照片。

### B Batch

可直接纳入正常生产实现，但保持队列式执行和 `AI concurrency = 1`。不要求先经过单张 PoC 阶段；如果第一轮开发时间需要控制，可先完成单张入口，再在同一生产功能迭代中补批量队列。

## 18. 本地任务 Runtime

建立独立 `LocalPhotoEditRuntime`：

```text
idle
loading_model
analyzing
processing
rendering
uploading
ready
failed
cancelled
```

复用现有 IndexedDB、任务恢复、失败重试和资源压力设计经验，但上传任务与编辑任务隔离。

编辑任务还应记录/暴露 `sourceOrigin = local | remote`，便于调试“为什么产生了网络读取”。

## 19. 本地源与网络读取审计

为了确保“本地能用就不走 CDN”真正成立，开发时增加可观察性：

- source resolver 明确返回 `local-original / local-variant / cache / remote-original / remote-variant`；
- 浏览器调试日志记录 source 类型，但不记录签名 URL；
- E2E/单测模拟本地 `originalBlob` 存在时，断言不会请求远端 original；
- 对本地照片应用 A/B 后，网络面板只应出现模型加载（首次）、edit PUT 和 complete/apply API，不应出现原图 GET；
- 换设备/清本地数据的测试才允许出现远端源 GET。

## 20. 安全、隐私与日志

推理数据流：

```text
本地文件或 PhotoStream 自有媒体
  → 已认证管理端浏览器
  → 本机内存/GPU
```

禁止 `browser → third-party AI provider`。

错误日志仅允许 pipeline/model version、backend、tile size、图片尺寸、sourceOrigin、error code、elapsed time；不得记录 Blob/base64、人脸 crop、tensor 或长期签名 URL。

## 21. 费用边界

A+B 不产生 AI 推理账单，不需要服务器 GPU。

允许新增成本：

- 自托管模型静态文件；
- 每个被保留 edit revision 的 480/960/1920/full-resolution download 四个对象；
- **仅当本地完整源不存在时**，管理端按需读取远端源产生的普通媒体流量/请求。

禁止把“为了实现简单”作为理由，在本地 `originalBlob` 明明存在时再次从 CDN 获取原图。

继续禁止云 AI、云图片修复/超分/生成、函数计算 AI 和新增付费视觉服务。

## 22. 生产环境中的验证与调参方式

不设独立模型 PoC 阶段。实现完成后直接部署到当前生产环境，由管理员在正式对外投产前使用真实工作流验证并调整：

- 模型大小与首次加载体验；
- WebGPU 兼容；
- tile/overlap；
- 960/1920/full-resolution 处理耗时；
- 峰值内存/显存；
- 降噪强度；
- 去模糊强度；
- A 自动参数范围；
- 舞台灯光、暗光、运动、合影、号码牌/文字等实际照片效果。

这些是生产环境内的正常调参与缺陷修正，不是“通过后才允许接入生产”的资格门禁。

发现某个模型效果不理想时，可以在保持相同模型接口与 revision 结构的前提下替换权重/模型版本；旧 revision 保存其 model version，不受后续替换影响。

## 23. 性能与质量目标

这些值用于调优，不作为接入生产前的额外门禁。

A：

- 960 slider 接近实时；
- 自动分析优先争取 `< 300 ms`；
- 常规 1920 确定性渲染优先争取 `< 2 s`。

B：

- 960 目标数秒级；
- 1920 优先争取约 10 秒量级以内；
- full-resolution 下载版允许更慢，但 UI 必须持续反馈进度且可取消；
- UI 不冻结；
- 单张失败不影响下一张。

质量重点：不能出现蜡像脸、错误文字/号码、明显 halo、错误纹理或大面积涂抹感。若出现则直接在当前生产环境调整模型/参数。

## 24. 测试计划

建议新增：

```text
photo-edit-analysis.test.ts
photo-edit-recipe.test.ts
photo-edit-pipeline.test.ts
photo-edit-source-resolver.test.ts
photo-edit-tiling.test.ts
photo-edit-model-runtime.test.ts
```

E2E 至少覆盖：

```text
本地 originalBlob 存在
→ 打开编辑器
→ 智能优化 / AI 修复
→ 断言无远端 original GET
→ 创建 revision
→ 上传 480/960/1920/download
→ complete
→ apply
→ viewer 更新但排序不变
→ viewer 原图下载解析到 edit download
→ revert
→ viewer 恢复 base original
```

以及：

- 本地数据缺失时远端 fallback；
- WebGPU 不可用；
- inference OOM/device lost；
- 模型加载失败；
- upload/complete 部分失败；
- apply 并发冲突；
- refresh 后 ready/applied revision 一致；
- active edit 时普通观众无法通过原图下载入口拿到 base original。

## 25. 预计代码区域

```text
apps/web/src/lib/photo-edit/
  source-resolver.ts
  analysis.ts
  recipe.ts
  renderer.ts
  model-runtime.ts
  tiling.ts
  model-manifest.ts

apps/web/src/workers/
  photo-edit.worker.ts

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

同时修改本地 review queue 的媒体映射、公共 variant/download resolver、SSE/media update、migration、API 路由、测试和 E2E。

## 26. 实施顺序

不设置独立 PoC 阶段，按正常生产功能直接推进。

### Phase 0：编辑基础设施与 SourceResolver

- DB schema/migration；
- contracts；
- `media_edit_revisions` / `media_edit_variants` / active revision；
- SourceResolver，本地原图优先；
- 四种 edit 输出：480/960/1920/download；
- edit API；
- OSS object path；
- complete/apply/revert；
- 公共浏览与下载解析；
- 实时更新且排序不变。

### Phase 1：A 智能调色直接接入

- analysis；
- versioned recipe；
- preview renderer；
- full-resolution export worker；
- editor UI；
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
- 根据生产环境实际照片和设备调整 A 参数、模型版本、tile、强度和缓存策略。

## 27. 首版功能清单

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

## 28. 固定实施决策

下一步编码按以下决策执行，无需再次讨论基础方向：

1. A+B 均不使用云 AI。
2. B 不设独立 PoC/验证阶段，直接作为生产代码能力接入；当前生产环境本身用于正式投产前的验证和调参。
3. 只要当前设备有完整本地上传源，就禁止为了修图从 CDN/OSS 重新获取原图。
4. 现有 `LocalReviewPhoto.originalBlob` 是同设备编辑时的首选最终导出源。
5. 真正上传的 `photo_original` 永不覆盖，只用于管理端恢复/重新编辑和无 active edit 时的公共最高质量下载。
6. 每个 edit revision 生成 `photo_480`、`photo_960`、`photo_1920` 和全分辨率 `photo_download`。
7. active edit 存在时，观众端“原图下载”必须解析到该 revision 的 `photo_download`，不得返回 base `photo_original`。
8. 编辑版本使用独立 revision 和不可变 OSS key。
9. 公共端只感知当前 active 版本，不需要理解编辑器内部历史结构。
10. WebGPU 是 B 首选执行后端；缺少 WebGPU 时 A 仍完整可用。
11. AI 推理单并发、可取消、失败隔离。
12. 模型只自托管、懒加载、长缓存，不使用第三方运行时模型 CDN。
13. 应用编辑只发媒体更新，不重新发布时间、不改变列表排序。
14. OCR 与人脸结果继续绑定 Media，不因普通修图重新计算。
15. 所有模型/参数变化通过明确 model/pipeline version 记录，允许在当前生产环境持续调整而不破坏旧 revision。

第一轮代码工作从 **Phase 0 → Phase 1 → Phase 2** 连续推进；不再插入独立模型 PoC 阶段。