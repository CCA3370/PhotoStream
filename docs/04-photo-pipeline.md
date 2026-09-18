# 照片处理与上传链路

状态：已批准的实施基线；已对齐 PR #112“及时上传 + hidden 多端审核”；本地智能修图采用独立 edit revision
更新日期：2026-09-18

## 1. 目标与权威状态

照片链路必须同时满足：

- 选择照片后尽快开始远端持久化；
- 上传与审核解耦；
- 多个审核设备共享同一个服务端 Media；
- 新上传照片默认 hidden，不自动公开；
- base 四对象完整长期保留；
- 本地原图存在时，管理端修图优先使用本地源；
- 媒体二进制不经过香港应用服务器；
- 基础上传/号码 OCR 不引入云图片处理费用。

PR #112 后，服务器 Media 是审核权威，IndexedDB 仅承担上传恢复、本地原图和预览加速。

## 2. 当前上传状态机

照片进入本地处理后：

~~~text
queued / processing
→ metadata ready
→ create remote hidden Media
→ ingestStatus = uploading_source
→ original + derived variants progressive upload
→ ingestStatus = ready
~~~

失败进入 failed/可重试路径。

Publication 独立：

~~~text
hidden ↔ published
deleted
~~~

审核“显示”不创建上传任务。只有 ingestStatus=ready 才允许 hidden → published。

## 3. metadata 后立即创建远端 Media

Worker 得到宽高、格式、Content-Type、拍摄时间后立即：

1. 创建 LocalReviewPhoto，保留真正 originalBlob；
2. 调用 progressive upload API；
3. API 创建远端 Media：
   - publicationStatus = hidden；
   - ingestStatus = uploading_source；
4. 建立 photo_original variant 和 UploadIntent；
5. 浏览器立即开始上传真正原图。

这一步不等待 480/960/1920。

远端 Media 一创建，其他已认证审核设备就可以看到它，即使上传设备仍在生成派生图。

## 4. 流式派生

Worker 继续生成：

~~~text
photo_480
photo_960
photo_1920
~~~

每个派生图一生成就：

1. 写入本机 LocalReviewPhoto.variants；
2. 向 API 登记规格；
3. 获取预签名上传能力；
4. 立即 PUT；
5. complete/校验；
6. 480 可继续生成 micro preview。

真正原图与派生上传并行。

## 5. Base Ready

Base 永远完整保留：

~~~text
photo_480
photo_960
photo_1920
photo_original
~~~

全部要求对象完成并验证后，Media 才进入 ingestStatus=ready。

即使照片有修图版本，也不能跳过任何一个 base 对象。

## 6. 多端审核

审核页从服务器读取 Media、featured、bib、publication 状态。

本机 IndexedDB 不是审核权威。

另一台设备：

- 没有上传设备的 originalBlob 也能审核；
- 可以看到上传中的 hidden Media；
- 可以在已有 preview 上做普通审核；
- ingestStatus != ready 时不能执行“显示”；
- category、featured、bib、show/hide 变化都以服务端为准。

现有 review sync 继续按可见页面轮询，并在 focus、online、pageshow 后立即恢复检查。签名 URL 轮换不应被当作业务状态变化。

## 7. LocalReviewPhoto 的新角色

LocalReviewPhoto 仍然有价值，但只承担本机能力：

- 保存真正 originalBlob；
- 保存本地 480/960/1920；
- OCR 本地上下文；
- 上传恢复；
- 为修图 EditSourceResolver 提供本地源；mediaId 未建立前用 localPhotoId 关联本地 draft，mediaId 回填后再绑定服务器 Media。

上传完成后不要无条件立即删除 originalBlob，否则同设备后续修图会产生不必要的 CDN/OSS 原图 GET。用户显式清理本机 LocalReviewPhoto 时，应同步删除对应 local edit draft，避免留下无源 IndexedDB 草稿。

但是：

- 本地记录被清理不能删除服务器 Media；
- 本地旧 publication/category/featured/bib 状态不能覆盖服务器；
- 服务器 active edit 已变化时，本地 base preview 不能冒充当前版本。

## 8. 修图与上传的关系

服务端修图以 mediaId 为长期身份；但上传设备可以在 mediaId 建立前先用 localPhotoId 保存本地 draft。

### 8.1 上传设备

上传设备持有真正原图，所以进入本地队列后即可开始 A/B 修图，不需要等待上传完成或 mediaId 已存在。

点击“应用”时：

~~~text
mediaId == null
→ IndexedDB draft = applied_local
→ progressive Media 建立并回填 mediaId
→ 在 base preview 可公开前 reserve pending edit
→ base 上传立即继续
→ edit 本地处理 / 上传与 base 并行

mediaId != null
→ 立即 reserve pending edit
→ 再执行本地处理 / edit 上传
~~~

reserve 只阻塞一个轻量控制面往返，不等待 AI 推理。

处理源优先：

~~~text
LocalReviewPhoto.originalBlob
→ 当前 File / 本机真正原图缓存
→ 已 verified 的远端 base photo_original
~~~

本地真正原图命中时，不得重新请求 CDN/OSS 原图。

### 8.2 其他设备

另一台审核设备没有 local original 时：

- 可先看已有 480/960/micro preview；
- remote base photo_original 未 verified 时，不允许最终全分辨率 Apply；
- base photo_original verified 后，可以读取远端原图并在当前浏览器本地处理；
- 是否能“显示”仍由 base ingest ready 决定。

### 8.3 Edit Revision

每个 edit revision 另外生成：

~~~text
edit photo_480
edit photo_960
edit photo_1920
edit photo_download
~~~

因此一个 Media 有 1 个 edit revision 时至少长期保留 8 个媒体对象。

edit 不能覆盖 base，也不能代替 base 完整性。

完整修图设计见[管理端本地智能修图](16-local-photo-editing.md)。

## 9. Base 与 Edit 并行调度

Base ingest 优先，不允许被 edit/AI 抢死。

建议网络优先级：

~~~text
base original / base 480 / base 960
> base 1920
> edit 480 / edit 960
> edit 1920 / edit photo_download
> 首次 AI model 下载
~~~

base 与 edit 共用总网络并发预算。

桌面总 PUT 并发可维持约 4，其中 base 至少保留 2–3 个槽位；移动端总并发 2 时 base 至少保留 1 个。

AI GPU queue 独立，B inference 单并发。

## 10. 修图状态与显示门禁

纯参数 draft 不影响审核。

用户点击“应用”后表达的是“期望当前版本切换到此 edit”：
- mediaId 已存在时立即创建 pending/rendering revision；
- mediaId 尚未存在时先保存 applied_local，本地 Media 一建立就必须先 reserve pending，再允许 base preview 进入可发布阶段。

hidden Media 的显示条件扩展为：

~~~text
ingestStatus == ready
AND pending edit == none
AND active edit（若存在）已 ready/active
~~~

因此：

- base ready、无 edit：可显示 base；
- base ready、edit ready+active：可显示 edit；
- base ready、pending edit rendering/uploading：暂不能显示；
- edit ready 但 base 未 ready：仍不能显示；
- auto publish 模式在 base preview ready 时如果仍有 pending edit，降级为 pending_review，不发布 base，也不把基础上传判失败。

用户可等待 pending edit 完成，或取消 pending edit 后显示当前旧 active/base。对于上传前已明确 Apply 的 edit，渲染/上传失败时服务端将 pending revision 标记为 failed 并保留首次发布 gate，避免静默取消后闪现 base；重试时客户端识别自己记录的 remoteRevisionId，显式取消旧 failed pending 后创建新 revision。

## 11. Published 后修图

published Media 创建新 edit revision 时：

~~~text
当前 active/base 继续服务观众
→ 浏览器本地处理
→ 上传 edit 4 对象
→ complete
→ ready
→ CAS apply
→ active revision 原子切换
→ media.updated
~~~

新 revision 准备期间不得：

- 隐藏当前照片；
- 分尺寸提前切换；
- 重新 media.published；
- 修改 publishedAt；
- 修改 publishSequence；
- 让照片跳到顶部。

## 12. 多端修图冲突

修图不能依赖本机锁。

服务端维护：

~~~text
active_revision_id
pending_revision_id
edit generation
~~~

Apply/Revert 使用 expectedGeneration + expectedActiveRevisionId 做事务 CAS。

如果另一台设备已经更新：

~~~text
409 EDIT_VERSION_CONFLICT
~~~

客户端必须重新读取最新版本，不能静默覆盖。

同一 Media 默认只允许一个服务器 pending edit revision。

## 13. 当前版本解析

管理端和公共端都以服务器 active revision 为权威。

### 浏览尺寸

~~~text
active edit
→ edit 480/960/1920

无 active edit
→ base 480/960/1920
~~~

### 最高质量下载

~~~text
active edit
→ edit photo_download

无 active edit
→ base photo_original
~~~

active edit 存在时，真正 base photo_original 只供管理端恢复、重新编辑、Before/After 和归档。

## 14. 编辑源原则

下一次编辑不得直接继续压上一次 edit photo_download。

正确方式：

~~~text
base photo_original
+ active recipe/model versions
→ 重建当前编辑状态
→ 用户调整
→ 新 revision
~~~

因此 revision 必须保存 recipe、pipeline version 和模型版本。

## 15. OCR 与人脸

普通修图不改变 Media 身份。

- OCR/bib 继续绑定 mediaId；
- 不因修图重新 OCR；
- 人脸索引继续按现有基础媒体规则维护；
- 人脸搜索返回 mediaId 后由当前版本 resolver 展示 active edit；
- 普通修图不重新聚类。

## 16. PUT / Multipart

- base/edit 480、960、1920 使用单 PUT；
- base photo_original >16MiB 继续使用 8MiB multipart；
- edit photo_download 超过阈值可复用 multipart；
- 预签名过期重新签同一对象；
- discarded edit revision 至少等待 20 分钟后才允许后台物理回收，确保 15 分钟旧签名 PUT 已失效；
- complete 使用幂等；
- 服务端校验对象后才更新状态；
- base/edit 共用网络并发预算。

## 17. 失败处理

| 失败 | 处理 |
| --- | --- |
| metadata/解码失败 | 本地任务失败，可重试 |
| base original PUT/part 失败 | 只重试对应对象/part |
| 派生上传失败 | 保持 hidden/incomplete，继续补传 |
| base ingest 未 ready | 禁止显示 |
| edit 失败 | base/current active 不受影响 |
| hidden + pending edit 失败 | pending status=failed；保持发布 gate；允许重试或显式取消 |
| discarded edit orphan | 20 分钟后由 deletion maintenance 删除 edit 对象/revision；失败自动后续重试 |
| 未发布 upload cancel/expire | 同时清 base 临时对象和 edit state/revisions/variants/对象 |
| published + new edit 失败 | 继续服务旧 active |
| 本地修图源缺失 | 仅在 remote base original verified 后 fallback |
| WebGPU/OOM/device lost | 只终止当前 B 操作 |
| 多端 edit 冲突 | 409，刷新最新 generation |

## 18. 性能与验收

- metadata 出来后应尽快创建 hidden Media；
- original 上传不等待派生生成；
- 派生生成一个上传一个；
- 多端审核以服务器状态为准；
- local original 存在时修图不得产生远端原图 GET；
- remote original 未 verified 的设备不得假装可完成全分辨率 Apply；
- base 未 ready 时任何 edit 都不能绕过显示门禁；
- published Media 新 edit 未 ready 时公共端保持旧版本；
- Apply/Revert 不改变 publishSequence；
- active edit 时观众最高质量下载命中 edit photo_download；
- 本机 stale base preview 不得覆盖服务器 active edit；
- abandoned upload cleanup 不得遗留 edit 对象，也不得因 edit revision 的 sourceVariantId 外键阻塞 base 清理；
- discarded edit cleanup 必须晚于预签名 PUT 有效期并支持失败重试。
