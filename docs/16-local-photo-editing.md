# 管理端本地智能修图

状态：已批准实施计划；尚未开始代码实现、模型 PoC 或生产验收
更新日期：2026-09-17

## 1. 目标与固定边界

PhotoStream 管理端增加一套完全在浏览器本机运行的非破坏性照片优化能力。该能力用于学校活动照片审核与快速修正，不进入上传主链路，不依赖云端 AI、服务器 GPU、函数计算或第三方推理服务。

本阶段固定分为两类：

- **A：智能自动优化**：曝光、白平衡、高光、阴影、对比度、自然饱和度、饱和度、基础锐化等确定性图像处理；不要求神经网络。
- **B：本地 AI 修复**：降噪、轻度清晰化/去模糊，以及由 A+B 组合得到的暗光增强；模型通过 ONNX Runtime Web 在管理端浏览器内执行，首选 WebGPU。

明确不进入本阶段的能力：

- 云端 AI 或云端媒体处理；
- 换脸、瘦脸、大眼等改变人物结构的处理；
- 去路人、去物体、生成式补画、扩图、换背景、换天空；
- 基于生成模型重绘人物、衣物、号码牌、文字或场景；
- 默认对全部照片执行 AI；
- 首版默认超分辨率；
- 覆盖或修改原始上传文件。

核心原则是：**修复与优化，不生成新的事实性视觉内容。** 学校活动照片具有纪实属性，任何可能改变人物身份、文字、号码、服装或场景事实的生成式操作都不应混入普通“一键优化”。

完整上传链路仍以[照片处理与上传链路](04-photo-pipeline.md)为准；本功能是审核后的独立编辑阶段。

## 2. 设计目标

实现必须同时满足以下目标：

1. **零云 AI 推理费用**：A+B 不调用任何云 AI API，也不要求 PhotoStream 服务器配置 GPU。
2. **照片不发送给 AI 服务商**：推理数据只存在于管理员浏览器内存/GPU；网络只用于读取 PhotoStream 自有媒体、读取自托管模型和上传管理员接受后的派生图。
3. **非破坏性**：`photo_original` 和现有原始派生图保持不变；所有编辑作为独立 revision 存在。
4. **可回滚**：应用编辑只切换 active revision；撤销不重新编码原图。
5. **不阻塞上传与发布**：A/B 失败不得影响上传、审核、发布、隐藏、精选、号码 OCR、人脸找图或普通浏览。
6. **适合高频审核**：绝大多数照片应通过“智能优化 → 应用”完成，不把管理端变成复杂专业修图软件。
7. **控制资源占用**：AI 推理默认单并发、分块执行、可取消、可降级，不允许造成审核页 OOM 或白屏。
8. **保持 CDN 与对象模型稳定**：编辑版本使用新的不可变 object key，不覆盖已缓存对象。

## 3. 与现有架构的关系

PhotoStream 当前已经在上传者浏览器使用 Worker、`createImageBitmap`、`OffscreenCanvas` 等能力生成 480/960/1920 派生图，并通过 OSS 直传避免照片经过香港应用服务器。该原则保持不变。

管理端编辑链路为：

```text
现有媒体（OSS/CDN）
        │
        ▼
管理端审核页
        │
        ├─ A：本地分析 + 确定性调色
        │
        └─ B：ONNX Runtime Web + WebGPU 本地恢复
        │
        ▼
浏览器生成编辑后 480 / 960 / 1920
        │
        ▼
直接上传 OSS 新对象
        │
        ▼
API 校验对象并将 revision 标为 ready
        │
        ▼
管理员 Apply
        │
        ▼
公共媒体解析器切换 active revision
```

照片二进制继续不经过香港 Fastify/Next.js/数据库。API 只负责：

- 创建编辑 revision；
- 签发源文件读取/派生图上传所需的短期能力；
- HEAD 校验对象；
- 保存 recipe、模型版本、状态与 active revision；
- 发出媒体更新事件。

## 4. A：智能自动优化

### 4.1 分析输入

为避免对完整 1920/原图执行昂贵统计，分析阶段先将图片缩小到最长边约 512–768 px。分析图只存在于本机内存，不上传。

至少计算：

- RGB histogram；
- luminance histogram；
- P1/P5/P50/P95/P99；
- shadow/highlight clipping 比例；
- 平均/分位饱和度；
- 动态范围；
- 中性色候选；
- 基础清晰度分数；
- 基础噪声估计。

分析结果只用于生成参数，不保存像素级统计或局部区域内容。

### 4.2 自动曝光

自动曝光不能只依赖平均亮度。应综合：

- 中位亮度；
- 暗部裁切；
- 高光裁切；
- P5/P95 动态范围。

输出 `exposureEv`。首版自动值限制在约 `-1.2 EV ~ +1.2 EV`；超出范围的照片只给出保守结果，不自动做激进曝光恢复。

### 4.3 自动白平衡

使用鲁棒的中性色/Gray-World 类方法，不直接对整张图片求 RGB 平均。优先选择：

- 非过曝；
- 非极暗；
- 低到中等饱和度；

的像素作为中性色候选，输出 `temperature`、`tint` 和 confidence。

舞台红光、蓝光和彩色灯光容易被错误“纠正”。当 confidence 低于阈值时，智能优化必须保持原白平衡，而不是强行中和现场灯光。

### 4.4 高光与阴影

根据 luminance 分布计算高光/阴影需求。首版自动参数保持保守，建议约束为：

- `highlights`: `-35 ~ +10`；
- `shadows`: `-15 ~ +40`。

避免过度 HDR、灰雾暗部和高光边缘异常。

### 4.5 对比度与 Tone Curve

使用轻度 S Curve 或等价 tone curve 实现，而不是直接对 RGB 做线性倍增。UI 参数可统一为 `contrast -100..100`，但智能优化自动值建议限制在约 `-15..+15`。

### 4.6 自然饱和度与饱和度

同时保留：

- `vibrance`；
- `saturation`。

智能优化优先修改 `vibrance`，对已经高饱和的颜色减少增益，并对典型肤色色相区域降低增强权重。这里不做人脸识别，仅做颜色区域保护，避免人物肤色被推成橙色或红色。

### 4.7 基础锐化

使用 Unsharp Mask 或等价高频增强算法。UI 首版只暴露一个“锐化”强度，内部固定合理 radius/threshold。

执行自动锐化前先计算 Laplacian/Tenengrad 类清晰度分数。已经足够清晰的照片应让自动锐化接近 0，避免白边和过锐噪点。

### 4.8 Edit Recipe

所有 A 操作必须先归一为版本化 recipe，而不是连续修改 JPEG/WebP：

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

最终效果应能由“源图 + recipe + pipeline/model version”稳定重现，避免多次保存造成累积压缩损失。

## 5. A 的渲染路径

### 5.1 Preview Renderer

审核编辑器优先使用 960 或 1920 变体作为预览源，并通过 WebGL2/WebGPU shader 或其他高性能 GPU 路径实时展示：

- exposure；
- white balance；
- highlights/shadows；
- contrast/tone curve；
- vibrance/saturation；
- sharpen。

拖动 slider 时不应重新生成 JPEG/WebP。目标是视觉反馈接近实时。

### 5.2 Export Renderer

最终导出放入 Dedicated Worker，避免阻塞 React 主线程。管理员只有点击“应用”或显式保存 revision 后才生成最终派生图。

## 6. B：本地 AI 修复

### 6.1 运行时

仓库已经使用 `onnxruntime-web`，因此 B 继续沿用同一端侧推理技术栈。首版执行策略：

```text
Photo
  ↓
Tile Splitter
  ↓
ONNX Runtime Web
  ↓
WebGPU Execution Provider
  ↓
Restoration Model
  ↓
Tile Merger
  ↓
A Color Pipeline
  ↓
Export
```

首版 B 不把 WASM/CPU 作为完整 1920 AI 推理的默认 fallback。缺少可用 WebGPU 时：

- A 继续正常工作；
- B 显示“当前设备不支持本地 AI 修复”或相应兼容性状态；
- 后续只有在小模型 CPU 实测达到可接受速度后才加入 WASM fallback。

### 6.2 模型选择原则

候选模型必须同时满足：

- 可导出/已有可靠 ONNX 路径；
- WebGPU 算子兼容性可接受；
- 模型大小可控制；
- 不以生成虚假细节为主要机制；
- 权重与代码许可证允许项目合法分发和使用；
- 可进行 FP16/量化或其他浏览器优化；
- 真实学校活动照片上不会明显修改脸部、号码牌、文字和服装纹理。

第一轮 PoC 可以从 NAFNet 类降噪/去模糊模型开始，但**候选名称不是最终技术承诺**。正式将任何模型权重放入仓库或生产静态资源前，必须重新核对：来源、权重许可证、代码许可证、模型转换过程、ONNX 运算兼容性和真实样片结果。

### 6.3 AI 降噪

UI 提供“AI 降噪”，强度可以显示为：

- 轻；
- 标准；
- 强。

首版优先只维护一个稳定模型，通过原图与 AI 结果混合控制强度：

```text
output = original * (1 - strength) + denoised * strength
```

这样可以减少模型数量，并降低人物出现“塑料脸”的风险。具体混合值由 PoC 评测确定，不在计划文档中硬编码为最终值。

### 6.4 AI 清晰化/轻度去模糊

清晰化使用独立恢复模型。它不能被“一键智能优化”默认开启，因为普通锐度不足、运动模糊、失焦和压缩模糊不是同一种问题。

分析模块可以提示：

> 检测到可能存在轻度模糊，可尝试 AI 清晰化。

但必须由管理员主动执行，并支持 Before/After 后再应用。

### 6.5 暗光增强

暗光增强不额外引入第三类模型。首版采用组合管线：

```text
A：曝光/阴影/高光/白平衡恢复
    ↓
B：AI 降噪
    ↓
A：轻度锐化/最终 tone
```

这样比黑盒“夜景生成模型”更可控，也更适合纪实照片。

### 6.6 暂缓超分辨率

PhotoStream 正常已经拥有原图和 1920 变体，大多数活动照片不缺像素。超分模型可能制造头发、衣服和文字的伪细节，因此首版不默认加入。

后续只有在真实业务出现大量低分辨率来源，并完成号码牌/文字/人物细节安全评测后，才评估超分辨率。

## 7. Tile 推理与资源管理

完整 1920 图片直接进入较大图像恢复网络会造成明显内存/显存压力，因此 B 必须支持 tile inference。

初始 PoC 建议从以下参数测试：

- tile：256×256；
- overlap：32 px；
- 边缘：reflect padding；
- 合并：weighted feathering，而不是硬拼接。

正式参数必须由真实模型 benchmark 决定。

### 7.1 自适应 Tile

可测试 384 → 256 → 192 的降级链路。发生 allocation failure、WebGPU OOM 或设备限制时最多降级有限次数，不能无限重试。

最终失败时应显示可理解信息并保留 A：

> 当前设备无法完成该 AI 修复，可继续使用普通智能优化。

### 7.2 并发

- A 分析：根据现有本地处理策略允许有限并发；
- B inference：首版固定并发 1；
- 不允许一次同时跑多张 1920 AI 修复。

### 7.3 资源释放

每个 tile 完成后尽快释放 Tensor/GPU buffer；ImageBitmap 不再使用时调用 `close()`；临时 Canvas、Blob URL 和 ArrayBuffer 不得被长时间引用。

模型 Session 可以短期保留以避免每张重新初始化，但离开审核工作区或超过 idle timeout 后应释放。

### 7.4 WebGPU Device Lost

必须处理 GPU device lost：

1. 当前 AI 任务失败并保持照片未修改；
2. 释放旧 session；
3. 最多重新初始化一次；
4. 再次失败则本次会话禁用 B，并保留 A 和所有审核功能。

任何 AI 异常都不得传播为整个审核页崩溃。

## 8. 模型加载与缓存

模型不得在进入 Studio 或审核页时自动下载。采用按功能 lazy loading：

```text
进入审核页 → 不加载 AI 模型
点击 AI 降噪 → 加载 denoise model
点击 AI 清晰化 → 加载 deblur model
```

生产模型必须由 PhotoStream 自托管，不允许运行时从 Hugging Face、GitHub Raw 或其他第三方 CDN 回退。

建议结构：

```text
/assets/models/photo-edit/
  {model-name}-{version}/
    model.onnx
    manifest.json
```

manifest 至少记录：

```json
{
  "name": "example-denoise",
  "version": "...",
  "sha256": "...",
  "precision": "fp16",
  "defaultTileSize": 256,
  "overlap": 32
}
```

模型文件采用 hash/version 固定 URL 与长缓存，第二次加载优先命中浏览器缓存。模型静态资源预算由 PoC 后写入费用/性能门禁，不在选型前先写死。

## 9. 处理源与最终 Pipeline

### 9.1 预览源

预览优先顺序：

1. `photo_1920`；
2. `photo_960`。

预览阶段不应为了移动一个 slider 就下载原图。

### 9.2 最终导出源

管理员确认应用时，优先以 `photo_original` 为最终处理源；如果原图尚不可用，允许显式退化到 `photo_1920`，但 UI 应提示“使用 1920 浏览版本作为处理源”。

### 9.3 Pipeline V1

首版固定顺序：

```text
1. Decode
2. Orientation
3. Resize working image to max 1920
4. AI Denoise（可选）
5. AI Deblur（可选）
6. Exposure
7. White Balance
8. Highlights / Shadows
9. Contrast / Tone Curve
10. Vibrance / Saturation
11. Sharpen
12. Encode 1920
13. Downscale 960
14. Downscale 480
```

整个处理顺序必须版本化，例如 `local-edit-v1`。未来算法调整应创建 `local-edit-v2`，不能静默改变旧 recipe 的语义。

## 10. 非破坏性数据模型

现有 `media_variants` 继续保存原始上传派生变体；编辑历史不要塞进固定 variant kind 中。

### 10.1 `media_edit_revisions`

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
created_at
ready_at
applied_at
failure_code
```

状态至少包括：

```text
draft
rendering
ready
applied
discarded
failed
```

`recipe_json` 只保存可重现编辑参数，不保存图像像素、AI tensor 或局部 crop。

### 10.2 `media_edit_variants`

建议字段：

```text
id
edit_revision_id
kind
object_key
format
content_type
width
height
bytes
etag
verified
created_at
```

首版 kind 仅需要：

```text
photo_480
photo_960
photo_1920
```

不创建编辑版 `photo_original`。

### 10.3 Active Revision

使用 `media_edit_state` 或等价字段保存：

```text
media_id
active_revision_id
updated_at
```

公共媒体解析只读取 active revision，不删除历史 revision。撤销只清空或切换 pointer。

## 11. OSS 对象与缓存

建议使用不可变路径：

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
```

不得覆盖现有 `480/960/1920` 对象。这样可以：

- 避免 CDN purge；
- 避免新旧缓存混用；
- 支持可靠回滚；
- 让每个 revision 可审计；
- 保持原始媒体对象不可变。

未被 active 的旧 revision 后续可按单独的存储清理策略处理，但首版先保留，避免误删回滚依据。

## 12. API 设计

建议新增以下 API；最终路由风格需与现有 Fastify 契约保持一致。

### 12.1 创建 revision

```text
POST /api/v1/media/:mediaId/edits
```

请求包含 recipe、pipeline/model metadata。响应提供：

- `revisionId`；
- 可读取的处理源能力；
- 480/960/1920 的短期 PUT 能力或等价上传意图。

### 12.2 完成上传

```text
POST /api/v1/media/:mediaId/edits/:revisionId/complete
```

API 对编辑派生对象执行必要的 HEAD/元数据验证，确认尺寸/bytes/content-type/etag 等符合契约后才标记 `ready`。

### 12.3 应用

```text
POST /api/v1/media/:mediaId/edits/:revisionId/apply
```

只允许 `ready` revision 成为 active。应用成功后发送媒体更新事件，不重新发布媒体。

### 12.4 回退

```text
POST /api/v1/media/:mediaId/edits/revert
```

清除 active revision 或切回指定历史 revision；不重新编码照片。

## 13. 公共媒体解析与实时更新

公共照片 API 保持现有 variant 形状，不要求观众端理解“编辑版本”。解析规则：

```text
存在 active edit
  → 返回 edit variants
否则
  → 返回原 media variants
```

原图下载始终指向真正的 `photo_original`，不能因为应用编辑而变成编辑后的 1920。如果未来需要“下载优化版”，应作为独立显式选项实现。

一张已经发布的照片后来应用修图时，只发送 `media.updated` 或等价更新事件；不得重新触发 `media.published`，不得改变发布时间，也不得让照片跳到列表顶部。

## 14. 与号码 OCR、人脸找图的关系

A+B 不改变 Media 身份，因此首版：

- 不因普通修图重新执行号码 OCR；
- OCR 候选、人工确认和年级/班级派生仍属于 Media，而不是 edit revision；
- 不因普通修图重新建立人脸索引；
- 人脸找图先得到 mediaId，再由公共媒体解析器返回当前 active revision。

如果未来加入会改变人物、文字、号码或构图的生成式编辑，则必须重新设计 OCR/人脸索引一致性，不能沿用本文件假设。

## 15. 管理端交互

在审核右侧 Inspector 增加“照片处理”区域：

```text
照片处理

[ 智能优化 ]

曝光            +0.3
色温            +4
高光            -12
阴影            +18
对比度          +5
自然饱和度      +7
饱和度           0
锐化            +4

AI 修复
[ AI 降噪 ]
[ AI 清晰化 ]

本机处理 · 图片不会发送至 AI 服务
```

### 15.1 智能优化

点击后立即：

```text
Analyze → 生成 Recipe → Preview
```

不弹多层复杂向导。管理员看到结果后可继续微调或 Reset。

### 15.2 Before/After

同时支持两种模式：

- **按住查看原图**：适合高速审核；按住显示原图，松开恢复编辑效果。
- **拖动分割线**：进入大图编辑器后显示 Before/After slider，用于精细比较。

### 15.3 AI 运行状态

首次使用 B 时显示模型准备进度，例如“正在准备本地 AI 模型”；执行时显示本机处理进度并明确：

> 所有 AI 计算均在此设备完成，照片不会上传至 AI 服务。

AI 失败只在照片处理区域显示，不产生全局错误页。

## 16. 批量工作流

### 16.1 每张独立智能优化

管理员选择多张照片后可执行“批量智能优化”。每张照片独立分析并生成自己的 recipe，不把同一曝光值强行套到全部照片。

### 16.2 同步当前参数

对于同机位、同光线的连续照片，允许将当前照片的 A 参数同步到选中的其他照片。同步操作必须明确显示选中数量并支持撤销/不应用。

### 16.3 B 的批量策略

首版不默认批量运行 AI。等单张性能、显存和失败恢复稳定后再加入 AI Batch Queue，并继续保持 AI concurrency = 1。

## 17. 本地任务 Runtime

AI 编辑建立独立 `LocalPhotoEditRuntime`，不要直接复用上传处理队列。状态建议：

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

可以复用现有本地处理队列的设计经验：IndexedDB 恢复、自适应资源判断、失败可重试、任务状态订阅等，但上传任务和编辑任务保持隔离，避免一种任务拖垮另一种任务。

浏览器刷新后不强求恢复 GPU inference 中间态；最多恢复“需要重新执行的编辑草稿/recipe”。已经上传并 complete 的 revision 以服务器状态为准。

## 18. 安全、隐私与日志

照片 AI 推理数据流必须保持：

```text
PhotoStream 自有媒体
  → 已认证管理端浏览器
  → 本机内存/GPU
```

禁止增加：

```text
browser → third-party AI provider
```

生产 CSP 不应为了模型功能开放未知模型域名。模型只从 PhotoStream 自有静态资源路径加载。

AI/编辑错误日志只记录最小技术信息，例如：

- pipeline/model version；
- backend；
- tile size；
- 图片尺寸；
- error code；
- elapsed time。

日志不得记录：

- 图片 Blob/base64；
- 人脸 crop；
- 像素 tensor；
- 长期签名媒体 URL；
- 原文件内容。

详细隐私原则继续受[安全、隐私与合规](07-security-privacy.md)约束。

## 19. 费用边界

A+B 本身不产生 AI 推理账单，也不需要服务器 GPU。允许新增的基础成本只有：

- 自托管模型静态文件的 OSS/CDN 存储与下载；
- 最终接受的编辑 revision 对应 480/960/1920 三个派生对象；
- 应用最终编辑时读取原图/1920 源产生的普通 OSS/CDN 请求与流量。

继续禁止：

- 阿里云或第三方云 AI 推理；
- 云端图片修复/增强/超分/生成；
- 函数计算承载 AI；
- 为本功能启用新的付费视觉服务。

费用政策同步见[费用控制](09-cost-controls.md)。

## 20. 模型 PoC

B 正式集成前必须先完成独立 PoC，不把未验证模型直接接到生产按钮。

### 20.1 样片集

准备约 30–50 张 Git 外授权测试照片，至少覆盖：

- 室内；
- 舞台；
- 运动；
- 合影；
- 逆光；
- 暗光；
- 高 ISO；
- 轻微运动模糊；
- 正常清晰照片；
- 包含号码牌/文字/细纹理的照片。

### 20.2 技术测试

候选模型至少验证：

- ONNX 导出/来源；
- WebGPU inference；
- FP16 或其他精度方案；
- 960 与 1920 性能；
- tile inference；
- tile 接缝；
- 首次加载体积与耗时；
- 峰值内存/GPU 内存；
- 取消与 device-lost 恢复；
- 长时间连续处理后的稳定性。

### 20.3 视觉验收

降噪不得明显产生：

- 蜡像脸；
- 头发/衣服纹理被抹平；
- 数字边缘消失；
- 大面积涂抹感。

清晰化不得明显产生：

- 双边/halo；
- 错误文字；
- 错误号码；
- 人工伪纹理；
- 人脸结构变化。

不得只看 PSNR/SSIM 决定上线；真实 PhotoStream 活动照片人工对比是最终门禁之一。

## 21. A 的验收门禁

A 上线前建立代表性样片集，至少覆盖彩色舞台灯、纯白背景、黑色舞台、逆光、夜间、高饱和服装和多人肤色。

目标：在代表性样片中，一键智能优化至少约 80% 达到“优于或不明显差于原图”，且不能频繁需要 Reset。

需要重点验证：

- 舞台灯光不会被强行白平衡成中性；
- 白衣和灯具高光不会大量炸白；
- 暗部不会拉出明显灰雾；
- 肤色不会系统性偏橙/偏红；
- 锐化不会产生白边；
- Slider 与 Preview 的视觉结果和最终 Export 足够一致。

## 22. 性能目标

性能值是工程目标，不是未实测的生产承诺。

### 22.1 A

在常规现代桌面设备上：

- 960 预览 slider 接近实时；
- 自动分析目标 `< 300 ms`；
- 1920 最终确定性 Export 目标 `< 2 s`。

### 22.2 B

PoC 初始目标：

- 960 AI 修复在数秒级；
- 1920 优先争取约 10 秒量级以内；
- UI 全程不冻结；
- 可以取消；
- 资源不足可降级/失败恢复；
- 单张失败不影响下一张。

最终上线门槛必须按实际目标管理设备重新确定，不能用开发机成绩替代。

## 23. 测试计划

建议新增单元/集成测试：

```text
photo-edit-analysis.test.ts
photo-edit-recipe.test.ts
photo-edit-pipeline.test.ts
photo-edit-tiling.test.ts
photo-edit-model-runtime.test.ts
```

E2E 至少覆盖：

```text
打开编辑器
→ 智能优化
→ 修改 slider
→ Before/After
→ Reset
→ 创建 revision
→ 上传 480/960/1920
→ complete
→ apply
→ viewer 更新但排序不变
→ revert
→ viewer 恢复
```

还必须验证失败路径：

- 模型下载失败；
- WebGPU 不可用；
- inference OOM；
- device lost；
- 上传一半失败；
- complete HEAD 校验失败；
- apply 并发冲突；
- refresh 后草稿/ready revision 状态一致。

总体测试门禁继续参考[测试与验收](10-test-and-acceptance.md)。

## 24. 预计代码区域

实际文件名以实施时现有目录结构为准，但建议职责拆分为：

```text
apps/web/src/lib/photo-edit/
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

同时预计修改：

- 审核 workspace/inspector；
- 公共媒体 variant resolver；
- SSE/media update 处理；
- 数据库 migration 与 exports；
- API 路由注册；
- 测试 fixture 与 E2E。

## 25. 实施阶段

### Phase 0：非破坏性编辑基础设施

先完成：

- DB schema/migration；
- contracts；
- edit API；
- OSS object path；
- complete/apply/revert；
- active revision 公共解析；
- 实时更新且排序不变；
- 安全/权限/审计。

此阶段不做 AI。

### Phase 1：A 智能调色

完成：

- image analysis；
- versioned recipe；
- preview renderer；
- export worker；
- editor UI；
- Before/After；
- Reset；
- apply/revert；
- 批量智能优化；
- 同步参数。

做到 Phase 1 后，即使 B 尚未上线，PhotoStream 已经拥有完整、可用、可回滚的本地照片优化系统。

### Phase 2：B 模型 PoC

独立验证：

- denoise 候选；
- deblur 候选；
- ONNX；
- WebGPU；
- FP16/量化；
- tile；
- 模型大小；
- 真实照片视觉质量；
- 许可证与分发边界。

PoC 不直接成为生产功能。

### Phase 3：B 正式集成

PoC 通过后增加：

- model loader/cache；
- AI runtime/worker；
- denoise；
- deblur；
- progress；
- cancel/retry；
- device compatibility；
- resource fallback；
- AI 强度混合；
- 错误隔离。

### Phase 4：批量与效率优化

在单张稳定后再增加：

- AI Batch Queue；
- 跨照片同步/复制 recipe 的更高效操作；
- 性能 telemetry 的本地/最小化统计；
- 可选快捷键。

AI batch 仍保持单 inference 并发，除非后续真实设备证明更高并发稳定。

## 26. 首版功能清单

### A 必做

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

### B 必做

- 本地 AI 降噪；
- 本地 AI 清晰化；
- A+B 暗光增强组合；
- WebGPU；
- tile inference；
- 本地模型缓存；
- 强度调节；
- Cancel/Retry；
- 设备兼容/失败降级。

### 明确暂缓

- AI 去路人/物体；
- Generative Fill；
- 换背景/天空；
- 人脸结构美化；
- 云 AI；
- 默认对所有照片运行 B；
- 默认超分辨率。

## 27. 目标管理端体验

正常照片：

```text
看到照片偏暗/色彩一般
→ 点击「智能优化」
→ 本地快速生成预览
→ 必要时微调
→ 点击「应用」
→ 浏览器生成 480/960/1920
→ 直接上传 OSS
→ 公共端实时更新该照片
```

噪声/轻度模糊照片：

```text
先完成 A
→ 主动点击「AI 降噪」或「AI 清晰化」
→ 本机 WebGPU 处理
→ Before/After
→ 接受后应用
```

绝大多数照片应该只需要 A；B 只服务确实需要恢复的少量问题照片。

## 28. 开始编码前的固定决策

下一步实施按以下决策执行，无需重新讨论基础方向：

1. A+B 均不使用云 AI。
2. 不改上传主链路，不让修图阻塞上传/发布。
3. 原图和现有原始派生图永不覆盖。
4. 编辑版本使用独立 revision 和不可变 OSS key。
5. 公共端只解析 active revision，不感知编辑器内部结构。
6. 原图下载始终保留真正上传原图。
7. A 先实现并独立可用；B 必须先经过模型 PoC。
8. B 首版只做降噪、轻度清晰化和暗光组合，不做生成式编辑。
9. WebGPU 是 B 首版主要执行后端；缺少 WebGPU 时 A 仍完整可用。
10. AI 推理单并发、可取消、失败隔离。
11. 模型只自托管、懒加载、长缓存，不允许运行时第三方 CDN 回退。
12. 应用编辑只发媒体更新，不重新发布时间、不改变列表排序。
13. OCR 与人脸结果仍绑定 Media，不因普通修图重新计算。
14. 任何模型正式进入生产前必须单独通过许可证、WebGPU、性能、视觉真实性和真实样片门禁。

第一轮代码工作从 **Phase 0 + Phase 1** 开始；Phase 2 的模型 PoC 可在编辑基础设施稳定后独立进行。