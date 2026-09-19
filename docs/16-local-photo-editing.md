# 管理端本地智能修图

状态：核心链路已实施；已按 PR #112“及时上传 + 多端审核”架构落地；修图仅保留确定性本地处理
更新日期：2026-09-19

## 1. 新架构基线

本方案以已经合并的 PR #112 为上传与审核基线。PR #113 只修复 Biome/lint，不改变业务行为。

PR #112 后，照片流程为：

~~~text
选择照片
→ 浏览器得到 metadata
→ 立即创建远端 hidden Media
→ 立即上传真正 photo_original
→ Worker 继续生成 480 / 960 / 1920
→ 派生图生成一个就登记并上传一个
→ 基础四对象全部校验完成
→ ingestStatus = ready
→ 任意审核设备执行 显示 / 隐藏
~~~

核心变化：

1. 远端 Media 很早就存在，不再等审核通过才上传。
2. 服务器 Media 是多端审核权威；IndexedDB 只做本机原图/预览加速。
3. 另一台设备没有本地队列记录也能审核同一个 mediaId。
4. 新上传照片默认 hidden；只有 ingestStatus=ready 才允许显示。
5. 本机如果仍持有 originalBlob，修图仍必须优先使用本地源，避免重复 CDN/OSS 原图 GET。

因此修图必须从“本地审核队列功能”改为“Media 的服务端协作功能”。

## 2. 三条独立状态轴

### 2.1 Base Ingest

继续由现有 IngestStatus 表达基础 photo_original + 480 + 960 + 1920 的完整度。

典型流程：

~~~text
uploading_source
→ 派生图逐步完成
→ ready

失败：
→ failed
~~~

修图不能替代或缩短 base ingest。

### 2.2 Publication

审核可见性只关心：

~~~text
hidden ↔ published
deleted
~~~

“审核通过”就是 hidden → published，不再创建上传任务。

### 2.3 Edit

修图独立使用：

~~~text
none
draft（仅本机）
rendering
uploading
ready
active
failed
discarded
~~~

三条状态轴必须独立保存。例如：

~~~text
base ingest = uploading
publication = hidden
pending edit = uploading
~~~

是合法状态。

## 3. 固定原则

1. 服务端修图长期身份使用 mediaId；mediaId 尚未建立前，本机 draft 以 localPhotoId 为临时身份，回填 mediaId 后绑定并同步。
2. 本地 originalBlob 是最高优先级处理源，但不是审核/当前版本权威。
3. base 480/960/1920/photo_original 永远完整保留。
4. 每个 edit revision 另外完整保留 edit 480/960/1920/photo_download。
5. 新 edit 必须始终从真正 base photo_original + recipe 重建，不能继续压上一版 edit 输出。
6. hidden/published 与 edit revision 独立。
7. published Media 切新 edit 必须在四个 edit 对象全部 ready 后原子切换。
8. hidden Media 已经有用户点击“应用”的 pending edit 时，在 edit ready 或取消前不能显示 base。
9. 只在本机拖参数但未点击“应用”的 draft 不阻塞其他审核员。
10. 多端冲突靠服务端 generation/CAS，不靠浏览器锁。
11. DisplayResolver 必须尊重服务器 active revision，不能让本机 stale base preview 覆盖其他设备刚应用的 edit。
12. 修图仅使用浏览器本机确定性处理，不加载图像恢复模型，也不使用云 AI 或服务器 GPU。

## 4. EditSourceResolver 与 DisplayResolver 分离

### 4.1 EditSourceResolver

最终全分辨率处理源优先级：

~~~text
1. 当前设备按 mediaId 命中的 LocalReviewPhoto.originalBlob
2. 当前内存/File handle 中的同一真正原始文件
3. 浏览器已明确缓存的 base photo_original
4. 已 verified 的远端 base photo_original
5. 都没有 → 当前设备不能执行最终全分辨率 Apply
~~~

硬规则：

只要 1–3 命中，就不得为了修图再次发起 CDN/OSS 原图 GET。

远端设备没有本地文件时，读取的是 base photo_original，不是 active edit 的 photo_download。

### 4.2 DisplayResolver

显示当前版本时：

~~~text
active edit 存在且对应 edit 资产可用
→ 当前版本使用 active edit
→ 若能从本地 original 精确按同一 recipe/model 重建，可本地加速
→ 否则使用远端 active edit variant

active revision 指针存在，但对应所需 edit variant 异常缺失/不可用
→ 容错回退对应 base variant

无 active edit
→ 可优先使用本地 base variant
→ 否则使用远端 base variant
~~~

因此本机本地文件只优化读取，不允许改变“当前版本”语义。正常状态机不会在 edit 未完成时切 active；上述 base fallback 只用于 active edit 资产异常丢失/损坏等容错场景。

## 5. 不同设备什么时候能修图

| Base 状态 | 当前设备有 local original | 可编辑 | 可 Apply | 可显示 |
| --- | --- | --- | --- | --- |
| uploading | 是 | 是 | 是 | 否 |
| uploading | 否，remote original 未 verified | 仅看已有 preview | 否 | 否 |
| uploading | 否，remote original 已 verified | 是 | 是 | 否 |
| ready + hidden | 任意 | 是 | 是 | 是，受 pending edit 约束 |
| ready + published | 任意 | 是 | 是 | 已显示，新 edit 原子切换 |
| failed/incomplete | 是 | 可继续修图 | 可生成 edit，但不能绕过 base 完整性 | 否 |
| failed/incomplete | 否 | 取决于远端源 | 可能不可用 | 否 |

上传设备因为握有真正原图，可以在 base 上传过程中直接修图。

其他审核设备只有在远端真正原图 verified 后才能完成最终 Apply；此前可以看已有 preview 和做普通审核。

## 6. Base 与 Edit 并行

Base 继续按 PR #112：

~~~text
metadata
→ create hidden Media
→ original 上传
→ 480
→ 960
→ 1920
→ ready
~~~

如果用户此时应用修图：

~~~text
mediaId 已存在：
reserve edit revision
→ server 立即写 pending/rendering
→ 本地 A/B 处理
→ prepare 四个 edit variant
→ 上传四对象
→ complete
→ ready
→ CAS apply

mediaId 尚未存在：
写 localPhotoId draft = applied_local
→ create progressive Media 后回填 mediaId
→ 在任何 base preview 可发布前 reserve pending revision
→ 立即放行 base 上传继续
→ 本地 A/B 与 base 上传并行
→ prepare / upload / ready / apply
~~~

reserve 只等待一次轻量控制面请求，不等待 AI 推理。edit 渲染或上传失败不会删除 base 对象；对于已明确 Apply 的未发布照片，失败的 edit gate 会保留，避免自动发布 base 造成首次闪烁。

对象数量：

~~~text
base:
  480
  960
  1920
  original

每个 edit revision:
  480
  960
  1920
  photo_download
~~~

一个 edit revision 时至少 8 个长期媒体对象。

Base 上传绝不能因 edit 取消、替代或覆盖。

## 7. 网络与 GPU 调度

统一网络并发，避免 edit 抢死及时上传。

建议优先级：

~~~text
最高：base original / base 480 / base 960
其次：base 1920
其次：edit 480 / edit 960
其次：edit 1920 / edit photo_download
最低：首次 AI model 下载、历史 revision 非必要操作
~~~

桌面总 PUT 并发可继续约 4，base 至少保留 2–3 个槽位；edit 默认只占 1 个。移动端总并发 2 时 base 至少保留 1 个。

AI GPU queue 独立，B inference 仍单并发。

## 8. Draft、Pending、Ready、Active

### 8.1 Draft

打开编辑器后的滑杆/AI 参数先形成本机 draft。

实现规则：

- 上传队列照片使用 IndexedDB `photostream-local-photo-edit-drafts` 持久化；
- mediaId 尚未建立时 key 为 localPhotoId；
- draft 保存 recipe、pipeline/model versions、sourceFingerprint、remoteRevisionId、Apply 时的 basedOnGeneration/basedOnRevisionId 和同步状态；
- 状态为 `draft / applied_local / syncing / synced / failed`；
- 仅拖参数、未点击“应用”的 draft 不同步给其他设备，也不阻塞显示；
- 点击“应用”但 mediaId 尚未建立时进入 `applied_local`，并绑定新 Media 的初始基线 generation=0 / active=null；Media 建立后自动绑定 mediaId 并同步；
- local original 仍存在时同步必须直接使用 `LocalReviewPhoto.originalBlob`，不得重新 GET 远端原图。

### 8.2 点击“应用”

点击应用后：

~~~text
mediaId 已存在
→ POST reserve revision
→ server 立即写 pending + status=rendering
→ 当前浏览器渲染
→ POST prepare（登记四个 immutable 输出）
→ PUT 四个对象
→ HEAD/complete 校验
→ 四个 edit 对象全部 verified 后 revision ready
→ CAS apply（仅接受 status=ready）
→ active revision 切换

mediaId 尚未存在
→ local draft = applied_local
→ mediaId 回填
→ reserve pending（必须早于 base 首次公开）
→ 后续与上面相同
~~~

### 8.3 Hidden Media

hidden Media 有 pending edit 时：

- 显示按钮禁用，提示“修图版本处理中”；
- edit ready 后完成 apply，再允许显示；
- edit 本地处理/上传失败时，服务器把该 pending revision 标记为 `failed`，但不清除 pending gate；
- failed pending 不会自动退回 base；用户可以重试，或显式取消 pending edit 后显示当前旧 active/base。

### 8.4 Published Media

published Media：

~~~text
当前版本继续服务
→ 新 edit rendering/uploading
→ 新 edit ready
→ CAS apply
→ 一次性切 active revision
→ media.updated
~~~

新 edit 准备期间不能分尺寸切换，也不能重新发布或修改 publishSequence。

## 9. 多端并发

不使用“打开编辑器即硬锁”。

新增 media_edit_state：

~~~text
media_id
active_revision_id
pending_revision_id
generation
updated_by
updated_at
~~~

打开编辑器时返回当前 active/pending/generation。

revision 记录：

~~~text
based_on_revision_id
based_on_generation
~~~

最终 Apply 携带：

~~~text
expectedGeneration
expectedActiveRevisionId
~~~

服务端事务/CAS：

- 一致：apply，generation + 1；
- 不一致：409 EDIT_VERSION_CONFLICT；
- 客户端要求重新载入最新版本；
- 不允许静默覆盖其他设备已经应用的 revision；
- 本地队列路径也必须沿用用户点击 Apply 时记录的 generation/activeRevisionId；同步前发现服务器已变化则标记冲突，不能自动 rebase 到最新版本。

同一 Media 默认只允许一个服务器 pending revision。另一设备已有 pending 时，新 Apply 返回冲突。

权限不通过扩大全局角色 permission 实现：admin/reviewer 按既有 `media:review` 权限修图；uploader 只能读取、创建、上传、应用、取消或回退自己上传的 Media 的 edit，访问其他 uploader 的 Media 返回 403。

以后可以增加“某某正在编辑”的软提示，但不是正确性基础。

## 10. Review Sync

PR #112 已有约 4 秒 visible-page 轮询和 focus/online/pageshow 恢复刷新。

修图接入后，review revision 必须额外包含：

~~~text
activeEditRevisionId
pendingEditRevisionId
pendingEditStatus
editGeneration
active edit variant bytes/version
~~~

仍然忽略旋转签名 URL。

另一个设备发生 create pending、complete、apply、revert，都应触发下一轮审核页刷新。

published Media active edit 切换后同时发送 media.updated 给公共端。

## 11. 数据模型

### 11.1 media_edit_state

~~~text
media_id PK/FK
active_revision_id nullable
pending_revision_id nullable
generation integer not null
updated_by nullable
updated_at
~~~

### 11.2 media_edit_revisions

~~~text
id
media_id
created_by
status
based_on_revision_id
based_on_generation
pipeline_version
recipe_version
recipe_json
source_variant_id
created_at
ready_at
applied_at
failure_code
~~~

source_variant_id 的业务语义始终指向 base original。local/remote 只是执行方式，不改变 revision 语义。

### 11.3 media_edit_variants

固定 kind：

~~~text
photo_480
photo_960
photo_1920
photo_download
~~~

对象不可变。

## 12. 编辑已有 edit

禁止：

~~~text
Edit A photo_download
→ 再压一次
→ Edit B
~~~

正确方式：

~~~text
base photo_original
+ Edit A recipe/model versions
→ 重建编辑状态
→ 用户调整
→ 生成 Edit B
~~~

因此 revision 必须保存完整 recipe/model version；旧模型资产只要还有 revision 引用就不能随意删除。

## 13. API

建议：

~~~text
GET  /api/v1/media/:mediaId/edit-context
POST /api/v1/media/:mediaId/edits
POST /api/v1/media/:mediaId/edits/:revisionId/prepare
POST /api/v1/media/:mediaId/edits/:revisionId/variants/:kind/sign
POST /api/v1/media/:mediaId/edits/:revisionId/variants/:kind/complete
POST /api/v1/media/:mediaId/edit-source
POST /api/v1/media/:mediaId/edits/:revisionId/complete
POST /api/v1/media/:mediaId/edits/:revisionId/apply
POST /api/v1/media/:mediaId/edits/:revisionId/fail
POST /api/v1/media/:mediaId/edits/:revisionId/cancel
POST /api/v1/media/:mediaId/edits/revert
~~~

create revision 是 reserve 请求，只包含 recipe、pipeline/model metadata、basedOnRevisionId、basedOnGeneration；四个输出的尺寸、格式和字节数由后续 prepare 请求登记。

客户端已有 local original 时，创建 revision 不应顺手签发原图 GET。只有客户端明确没有本地真正原图，并且 base original 已 verified 时，才请求 edit-source。

complete 必须校验四个 edit 对象全部 verified。

apply 使用 expectedGeneration / expectedActiveRevisionId 做 CAS。

## 14. “显示”门禁

现有门禁：

~~~text
ingestStatus != ready
→ 不能显示
~~~

修图后扩展：

~~~text
if ingestStatus != ready
  reject

if pending_revision_id != null
  reject "修图版本仍在处理中"

if active_revision_id != null
  require active revision ready/active

otherwise
  hidden → published
~~~

因此：

- base ready、无 edit：可显示 base；
- base ready、edit ready+active：可显示 edit；
- base ready、pending edit rendering/uploading/failed：暂不能显示；
- failed pending 必须重试或显式取消，不能静默清 gate 后显示 base；
- edit ready 但 base 未 ready：仍不能显示；
- auto publish 相册在 base preview ready 时如果仍有 pending edit，不报上传失败，也不发布 base，而是停在 pending_review；
- pending edit apply 或明确取消后，才允许首次公开。

## 15. 公共解析与下载

浏览：

~~~text
active edit 且对应 variant 可用
→ edit 480/960/1920

active edit variant 异常缺失/不可用
→ fallback 对应 base 480/960/1920

无 active edit
→ base 480/960/1920
~~~

“原图下载”：

~~~text
active edit 且 photo_download 可用
→ active edit.photo_download

active edit photo_download 异常缺失/不可用
→ fallback base photo_original

无 active edit
→ base photo_original
~~~

正常 active edit 存在时，真正 base photo_original 只供管理端恢复、重新编辑、Before/After 和归档；只有服务端检测到 active edit 资产异常不可用时，公共 resolver 才允许自动 fallback base，客户端不能主动绕过 active revision。

## 16. UI

上传队列、审核卡片和 Inspector 分别表达：

~~~text
上传：上传中 / 已上传 / 失败
可见性：待审核或已隐藏 / 显示中
修图：未修图 / 已应用·本地 / 正在同步修图版本 / 修图版本已同步 / 修图同步失败
~~~

上传队列照片一进入本地队列即可打开同一个 PhotoEditor。默认只显示进行中/失败项，按需“显示已上传”后可继续编辑本机仍保留 originalBlob 的已上传照片，避免默认一次创建大量 Object URL。本机显式清理 LocalReviewPhoto 时必须同时清理对应 local edit draft，不能留下无源 IndexedDB 草稿。

其他设备看到上传中的 Media：

- 可以查看已有 preview；
- remote original 未 verified 时显示“原图上传中，完整修图暂不可用”；
- original verified 后自动变为可编辑。

点击应用后显示：

~~~text
正在生成修图版本
→ 本机处理
→ 正在上传 1/4…4/4
→ 正在校验
→ 已应用
~~~

并发冲突：

~~~text
此照片已在其他设备更新。
[查看最新版本] [保留我的参数并重新基于最新版本应用]
~~~

不能静默覆盖。

## 17. 确定性本地修图

修图仅保留确定性本地处理：曝光、白平衡、高光/阴影、对比度/Tone Curve、Vibrance、Saturation、基础锐化；全部保存为版本化 recipe。

已移除降噪、清晰化等图像恢复模型能力及其 ONNX Runtime 调用、模型供应链、模型缓存、专用 Worker、模型元数据字段和生产构建下载流程。修图不下载或执行任何图像恢复模型。

号码 OCR 是独立链路：PaddleOCR.js、其 ONNX Runtime/WASM/WebGPU 运行时和 `/assets/models/bib-ocr/` 自托管资源继续保留，不受本次修图能力清理影响。

## 18. LocalPhotoEditRuntime

建议状态：

~~~text
idle
loading_source
analyzing
processing
rendering
uploading
verifying
applying
ready
conflict
failed
cancelled
~~~

服务端运行以 mediaId 为主身份；pre-mediaId 本地 draft 以 localPhotoId 为 key，mediaId 回填后绑定。

诊断字段：

~~~text
sourceOrigin
baseIngestStatus
publicationStatus
editGeneration
activeRevisionId
pendingRevisionId
~~~

上传 runtime 与 edit runtime 独立，但共享总网络并发预算。

## 19. OCR / 人脸

修图不改变 Media 身份：

- OCR/bib 继续绑定 mediaId；
- 不因普通修图重新 OCR；
- 人脸索引继续按现有规则绑定 Media；
- 人脸结果拿到 mediaId 后由 DisplayResolver 展示 active edit；
- 普通修图不重新聚类；
- edit 不改变号码/人脸审核结论。

## 20. 测试矩阵

必须覆盖：

1. 上传设备 base uploading + local original：修图无原图 CDN GET。
2. 另一设备上传期间打开：remote original 未 verified 时 Apply disabled；verified 后可修。
3. base ready + hidden + no edit：可显示 base。
4. base ready + hidden + pending edit：show rejected；edit active 后可显示。
5. published 后修图：旧版本持续服务，新 revision ready 后原子切换，publishSequence 不变。
6. 两设备 generation 冲突：后提交者得到 409，不覆盖先提交者。
7. local original 存在：EditSourceResolver 不请求 remote original。
8. local original 不存在：只读取 verified base original。
9. 正常 active edit 时 viewer 下载命中 photo_download；若 active edit 资产异常缺失/不可用，resolver 自动 fallback base original。
10. 本机 stale base preview 不得覆盖服务器 active edit。
11. base ingest failed 时即使 edit ready 也不能显示。
12. pending edit 取消后可继续显示当前旧 active/base。
13. pre-mediaId 已应用本地 edit：mediaId 建立后必须先 reserve pending，再允许 base preview 进入可发布阶段，不能闪 base。
14. edit 渲染/上传失败：base ingest 独立继续，服务器 pending status=failed，已应用的首次发布 gate 不得静默丢失。
15. failed pending 显式取消后 revision 进入 discarded；未超过签名 PUT 有效期时不得物理清理，超过 20 分钟后后台可重试删除其 edit 对象与 revision。
16. 未发布上传被 cancel/expire 后，upload cleanup 必须同时清理该 Media 的 edit state/revisions/variants 和 OSS edit 对象，且不能被 sourceVariantId 外键阻塞。
17. uploader 只能修自己的 Media；对其他 uploader Media 的 get/apply/revert 均返回 403。
18. auto publish + pending edit：480/960 完成后进入 pending_review，不把上传标失败，也不发布 base。
19. edit 四个输出未全部 verified / revision 未 ready 时调用 apply 必须返回 409，activeRevisionId 保持不变。
20. activeRevisionId 异常指向缺失/不可用 edit 资产时，普通相册、分享页、预览和最高质量下载均自动 fallback 对应 base 资产。

## 21. 实施顺序

### Phase 0：服务端编辑状态

- migration；
- media_edit_state；
- media_edit_revisions；
- media_edit_variants；
- active/pending/generation；
- edit-context；
- CAS apply/revert；
- review sync 纳入 edit state；
- show 门禁纳入 pending edit。

### Phase 1：Resolver

- findLocalReviewPhotoByMediaId 接入 EditSourceResolver；
- local original 优先；
- remote base original fallback；
- DisplayResolver 支持 active edit；
- stale local preview 保护；
- public variant/download resolver。

### Phase 2：确定性修图

- analysis；
- recipe；
- preview；
- full-resolution export；
- revision upload；
- complete/apply；
- Before/After；
- conflict UI。

### Phase 4：效率

- 批量参数应用；
- 参数同步；
- soft edit presence；
- 生产环境调参。

## 22. 固定实施决策

1. PR #112 后，修图以服务器 mediaId 为长期身份。
2. 上传一开始 Media 即 hidden 存在；审核通过只做 hidden → published。
3. 本地 originalBlob 仍是同设备修图最高优先级源。
4. 其他设备没有 local original 时，从 verified base photo_original 读取。
5. 编辑始终以 base original 为语义源，不继续压上一版 edit 输出。
6. base 四对象无论是否修图都完整保留。
7. 每个 edit revision 额外完整保留四对象。
8. 只有点击 Apply 才表达“期望当前版本切到此 edit”：mediaId 存在时立即 reserve 服务器 pending；mediaId 尚未存在时先写 applied_local，回填 mediaId 后必须在 base preview 可公开前 reserve。
9. 纯参数 draft 不影响其他设备；已 Apply 的 pending edit 存在时 hidden/pending_review Media 暂不能显示 base，除非 edit apply 成功或明确取消 pending。
10. published Media 在新 revision ready 前继续显示旧版本；ready 后原子切换。
11. active/pending/generation 全由服务器同步；多端冲突用 CAS/409。
12. DisplayResolver 必须尊重服务器 active revision，不能被本机 stale base preview 覆盖。
13. 正常 active edit 时观众最高质量下载指向 edit photo_download；active edit 资产异常缺失/不可用时服务端自动 fallback base photo_original。
14. 修图不改变 publishSequence、OCR、人脸标签或 Media 身份。
15. 修图只允许确定性本地处理；不得重新接入降噪、去模糊等图像恢复模型，除非重新进行架构与成本审批。
16. uploader 不获得全局 media:review；修图服务按资源所有权允许 uploader 仅编辑自己上传的 Media。
17. base upload 与 edit 同步状态独立；edit 同步失败不能把已成功的 base 对象回滚或删除。
18. failed pending 必须保留发布 gate；retry 会显式取消旧 failed revision 后创建新 revision，cancel 则把旧 revision 标为 discarded。
19. discarded revision 只在至少 20 分钟后回收对象，覆盖 15 分钟预签名 PUT 的失效窗口；删除失败保留 DB 记录供后续维护重试。
20. 未发布上传 cancel/expire 时必须先回收 edit 对象/状态/revision，再删除受 sourceVariantId RESTRICT 约束的 base variant。
21. 本机 LocalReviewPhoto 被显式清理时必须同时删除对应 IndexedDB edit draft。
