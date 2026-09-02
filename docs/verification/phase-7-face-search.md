# 阶段 7：人脸候选找图实现验证

日期：2026-09-01
范围：本地代码、契约、迁移、供应商适配、管理端/观众端 UI 与静态复查；不含云资源、真实人脸样本或部署

> 历史证据说明：本记录验证的是当时固定杭州地域的实现。2026-09-02 的 [ADR-013](../adr/013-beijing-aliyun-data-plane.md) 已修订当前地域；北京代码变更另行验证，真实北京云端仍为 **Unverified**。

## 结论

人脸候选找图的本地实现已完成，功能继续由 `FACE_SEARCH_GLOBAL_ENABLED=false` 默认关闭。共享契约与数据库状态、杭州 IMM/临时 OSS/EventBridge 适配、持久任务与删除、管理端门禁/排除/整册删除、观众单独同意/本地预处理/直传/轮询结果均已有代码和本地自动化证据。

本阶段为 **Confirmed（本地实现范围）**。真实 PostgreSQL 事务、阿里云 API、授权评测集、微信/Safari/辅助技术、数据出境评估、账单与生产部署没有证据，全部保持 **Unverified**，不得据此开启全局开关。

## 实现映射

| 文档要求 | 实现与复查结果 | 状态 |
| --- | --- | --- |
| 默认关闭、口令相册与逐项启用门禁 | 配置默认关闭；API 独立校验全局开关、口令访问、隐私/投诉、当前告知与阈值版本及七项授权确认；公开访问事务内立即停搜并建立删除任务 | Confirmed（代码） |
| 最小持久状态 | 独立相册索引、媒体任务、短期意图/候选、最小同意回执与 EventBridge 幂等表；无向量、人脸框、人物、聚类或分数列 | Confirmed（契约/迁移） |
| 已发布且 HEAD 验证的 1920 索引 | 只调度 `published + verified photo_1920`；发布不等待索引；隐藏/删除/排除先由 PostgreSQL 过滤 | Confirmed（代码） |
| IMM 显式编排 | 固定 `Official:FaceManagement`，独立随机 Dataset，`IndexFileMeta`、聚类任务读回、同步聚类分页与异步 Top 100 补查均为显式 API | Confirmed（适配器/单元） |
| 参考照不经过香港正文 | 浏览器纠正方向、Canvas 去元数据并压到 JPEG ≤1920/≤3 MiB；精确签名、禁止覆盖的 OSS PUT；API 只 HEAD 大小/类型/ETag | Confirmed（代码/单元） |
| 单独同意与非身份核验文案 | 每次打开独立对话框，分开声明“本人/监护人或已获授权”与同意复选框；展示处理者、供应商、目的、方式、期限、风险和投诉；结果固定称“可能包含此人的照片” | Confirmed（UI/Storybook 构建） |
| 私有搜索、限流与短保留 | 搜索绑定访客会话；会话和每日 IP-HMAC 同时执行 3/10 分钟与 10/日事务限流；参考照 1 小时、结果 2 小时 | Confirmed（代码） |
| EventBridge 安全边界 | V2 RSA 规范串、官方证书 HTTPS allowlist、无重定向、60 秒窗口、账号/地域/Project/Dataset/Task/type 绑定、大小/深度限制和事件幂等 | Confirmed（单元/代码） |
| 迟到事件与当前授权 | 事件只可推进 `processing/partial` 且未过期任务；候选写入和每次读取只接受当前 `published + indexed` 媒体，取消/过期任务不会复活 | Confirmed（复查修正） |
| 删除可验证且不阻塞普通相册 | 参考照失败/完成/取消清理并持久重试；整册先分页删元数据再删 Dataset 并读回；永久删除照片等待 IMM 元数据确认后才删除 1920/其他对象 | Confirmed（代码；真实供应商未验证） |
| 生命周期 | 进入 `ended` 设置最长 30 天期限，`archived` 不延长，重新 `live` 清除；改公开、关闭或整册删除立即禁用并持久清理 | Confirmed（代码） |
| 管理端最小展示 | 只显示开关、告知/阈值版本、授权时间、覆盖/失败/排除计数、聚类/删除期限和通用错误；支持重试、选中照片排除和二次确认整册删除 | Confirmed（UI） |
| 公共包体控制 | 公共页只渲染轻量启动器，点击后动态导入同意/预处理/结果面板；参考照上传 origin 只加入精确 CSP `connect-src` | Confirmed（生产构建/代码） |

## 本地自动化证据

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm --filter @photostream/contracts typecheck/test/build` | 退出码 0 | 19 项契约单元测试通过 |
| `pnpm --filter @photostream/db typecheck/build` | 退出码 0 | schema 与声明产物构建成功 |
| `pnpm --filter @photostream/api typecheck/test/build` | 退出码 0 | 8 个测试文件、29 项单元测试通过；API 产物构建成功 |
| `pnpm --filter @photostream/web typecheck/test/build` | 退出码 0 | 5 个测试文件、12 项单元测试通过；Next 16 生产构建成功 |
| `pnpm --filter @photostream/web storybook:build` | 退出码 0 | 图片输入门禁与 Storybook 静态构建成功；含人脸同意与管理设置故事 |
| 变更文件精确 `biome check` | 退出码 0 | API、Web、contracts 本阶段变更无格式或 lint 诊断 |
| `git diff --check` | 退出码 0 | 无空白错误 |
| `pnpm check` | 退出码 1 | 在 lint 前置资产门禁停止：Windows checkout 将已跟踪的 `ort-wasm-simd-threaded.mjs` 从清单要求的 24,274/LF 字节变为 24,333/CRLF 字节；归一化 LF 后 SHA-256 与清单完全一致。该既有 OCR 资产未被本阶段修改 |

`pnpm check` 的失败不能标记为通过，也不代表人脸变更失败。为避免改写无关的供应商 OCR 产物，本阶段保留原文件；直接类型、单元和构建检查分别执行并记录如上。

## 最优性复查修正

按规格实现后再次从删除、并发和授权失效方向复查，额外修正：

- 照片永久删除与人脸元数据删除建立硬门禁，避免普通对象先删除后失去 IMM URI，且新增真实 PostgreSQL 集成测试用例；
- 公开访问切换与人脸禁用/搜索取消/整册删除任务进入同一相册设置事务，并清除整册授权确认，改回口令不会自动恢复；
- 迟到或重复 EventBridge 事件不能复活取消/过期搜索；异步候选和读取都重新要求媒体仍为 `indexed`；
- 禁用或删除中的相册不会继续处理待索引任务；删除分页检测重复批次/分页 token，避免供应商最终一致性造成无限循环；
- 已启用配置的普通保存不再无故把 `ready` 重置为 `indexing`；删除未完成时拒绝重新启用；
- 索引确认与聚类轮询设置明确上限，失败任务只由管理员重试；聚类仅在新一批媒体确认索引后触发，避免无限轮询和空批次重复计费；
- 相册失效只取消仍在处理的意图，不改写已完成回执；参考照确认删除后，搜索意图/任务摘要和事件幂等记录在满足每日限流窗口后短期清除，不形成长期搜索历史；
- 观众换图会先请求删除旧搜索，CSP 只为参考照私有 OSS 增加精确连接 origin，面板保持点击后懒加载。

## 未验证

以下项目没有在本地结果基础上升级：

- 当前主机没有 Docker 命令，无法启动 PostgreSQL 18.6；迁移、FaceService/媒体删除真实事务和新增数据库集成用例为 **Unverified**；
- 未调用 IMM、OSS 或 EventBridge，接口形状以锁定 SDK 和适配器单元测试为证，云端行为、删除读回、延迟、费用与额外属性仍为 **Unverified**；
- 未使用任何人脸照片；50 人授权评测集、零观察错误关联、命中率/召回率、阈值和供应商版本资格均为 **Unverified**；
- iOS/Android 微信、Safari/Chrome、校园网络、屏幕阅读器、键盘全流程和 axe 浏览器回归为 **Unverified**；
- 学校同意/监护人流程、个人信息保护影响评估、跨境判断、投诉演练、RAM/生命周期配置和生产发布为 **Unverified**。

在这些门禁分别产生新鲜证据并获得相应授权前，只能保留本地实现和默认关闭状态。
