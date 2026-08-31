# 阶段 5：安全与性能加固验证

日期：2026-08-31
状态：**本地实现与针对性自动化 Confirmed；最终整仓回归未重跑，目标主机、真实设备和云端仍有 Unverified 门禁**

## 1. 完成范围

- 主站逐请求 nonce CSP、HSTS、Host/Origin/CSRF、生产 `__Host-` Cookie、可信本机反向代理和最小化结构化日志；生产 CSP 只允许精确 CDN/OSS 上传 origin，拒绝媒体元素、object、frame、脚本属性与生产 `unsafe-inline`/`unsafe-eval`。
- 上传 PWA manifest、离线壳和最小 Service Worker；Cache Storage 只保存离线壳与同源哈希构建资源，不保存 API、口令相册、工作台页面或 OCR 模型。
- 取消/过期上传的持久清理状态、multipart abort、对象删除、已发布预览保留、失败退避与重启恢复；为已签发在途 PUT 保留 30 分钟宽限并在 24 小时后执行第二次确认扫，连续两次成功才完成；0011/0013 增加任务字段/索引。
- 号码 current/previous 数据密钥、搜索密钥和版本成组校验；旧密文双读、旧/新 blind index 双查、隐私化幂等双摘要、每批 200 条重加密、未知版本启动失败；0012 增加版本扫描索引。
- 永久删除成功后显式删除号码密文、blind index、派生属性、候选框与复核记录；对象或 CDN 失败时仍保留数据库权威记录供重试。
- 30 天匿名事件、操作幂等、批量摘要、过期内部/访客会话和已结束/归档相册 SSE 事件清理；直播中事件不裁剪。
- RSA-OAEP-SHA256 + AES-256-GCM 流式加密备份，至少 3072 位收件人密钥、篡改拒绝、仓库外输出；恢复只接受空白 `photostream_restore_*` 隔离库，先完整认证解密，再以单事务 `pg_restore` 恢复并删除临时明文。
- 可执行[运维、备份与事件响应手册](../13-operations-runbook.md)，覆盖密钥轮换、孤立上传、恢复演练、内容事件和 CDN 域名迁移顺序。

## 2. 新鲜自动化证据

环境：WSL/Linux，Node.js 24.17.0，pnpm 11.24.0，本地 Docker PostgreSQL 18.6，Windows Headless Chrome 151.0.7922.174。常规自动化均为虚构元数据或合成非人物图片；本节明确标注的本地照片检查使用用户提供、Git 忽略且不输出文件名/内容/号码的 `test_photos/`。

| 检查 | 结果 | 状态 |
| --- | --- | --- |
| `pnpm check` | 最后一次整仓检查：Biome 210 文件、6 个 workspace 类型检查、58 个单元/契约测试、6 个 workspace 构建全部通过；此后追加本地样片工具/用例及双次清理竞态修正，用户要求不再重跑整仓门禁 | Confirmed（最终修正前检查点） |
| PostgreSQL schema integration | 4/4；照片专用 schema、上传清理列/枚举和两个恢复索引精确断言 | Confirmed |
| API/PostgreSQL integration | 24/24；含 current/previous 号码轮换、取消/过期清理、失败重试、预览保留、号码隐私删除、outbox 回滚、会话/事件清理 | Confirmed |
| 容量门禁（固定 2 CPU） | 5,000 照片、84 页，分页 p95 4.2ms；500 SSE p95 147.53ms；测试进程峰值 RSS 298,256KiB | Confirmed（本机约束） |
| Next 生产构建（固定 2 CPU、V8 heap 1.5GiB） | 构建通过；峰值 RSS 563,088KiB，无 swap | Confirmed（本机约束） |
| Storybook build | 2,462 modules，构建通过；仅 Storybook/axe 大 chunk 警告，不进入产品初始路由 | Confirmed |
| Playwright/axe 全回归 | 最后一次全量回归 14/14；含 nonce/HSTS、上传/续传/multipart/取消、PWA 离线壳与缓存边界、号码、审核/下载/删除、权限及 5,000 DOM；双次清理竞态修正后未重跑全量 E2E | Confirmed（最终修正前检查点） |
| agent-browser 开发检查 | 页面有内容、无 Next 错误覆盖层、无 page error；内联执行脚本均带请求 nonce | Confirmed |
| standalone 生产运行 | 正确复制 `public`/`.next/static` 后启动；CSP 无 `unsafe-eval`，含两个精确数据面 origin；所有有正文内联脚本带 nonce，页面无错误覆盖层/page error | Confirmed |
| OCR 供应链门禁 | 18 文件哈希/大小通过；WASM gzip 12,591,182 bytes、WebGPU 15,234,771 bytes；篡改、远程回退、越界路径、超预算负向夹具全部被拒 | Confirmed |
| 本地照片全量只读审计 | 813/813 JPEG 结构头与 EOI 有效，合计 13,598,104,177 bytes；全部 6240×4160（25.96MP）、无 >50MiB/>100MP；813 含 EXIF/GPS，未发现尾随数据 | Confirmed（Git 外聚合） |
| 本地照片真实浏览器管线 | 按体积分位抽取 12 张；Worker 解码、480/960/1920 WebP、直传与完成全部通过；中位 5.258s、p95 6.343s，派生中位 77,900 bytes、最大 782,108 bytes，36/36 派生无 EXIF/XMP/ICC | Confirmed（Chromium 样本） |
| 本地照片 OCR 烟测 | 按体积分位抽取 3 张，全部完成本地 OCR；管线中位约 5.787s，候选数 `[0,1,1]`；无真值，因此不计算准确率 | Confirmed（执行）/ Unverified（准确率） |
| 备份封装门禁 | 往返通过；篡改 tag 和 2048 位弱 RSA 收件人被拒，失败明文输出被删除 | Confirmed |
| 真实备份/隔离恢复 | 26 张 public 表、14 个迁移；源/恢复库的 users/albums/media/variants/bib_tags/audit 六组计数分别为 `1/2/113/452/42/248` 且逐项一致；非空目标在写入前拒绝 | Confirmed（本地） |
| 空库迁移 | 0000–0013 共 14 个迁移，26 张 public 表，清理/密钥索引及二次清理计数存在；Drizzle 再生成无漂移 | Confirmed |
| 依赖审计 | 生产依赖 0 已知漏洞；完整开发图仅 Storybook 间接 `image-size` 两条 high 且无修复版本 | Confirmed / Accepted dev-only risk |

## 3. 故障演练与复查结论

- PostgreSQL 容器曾在一次集成测试前停止，测试只报首连接超时且未执行断言；确认 `postgres` 未运行、重新启动并通过 `pg_isready` 后，同一数据库/API 套件 4/4 与 24/24 通过。
- 开发库包含早期不同测试密钥产生的 `local-v1/test-v1/v1` 合成标签；新的启动覆盖门禁按设计拒绝单密钥启动。浏览器回归使用开发库只读克隆，并仅在克隆中清空合成号码标签；原开发库未删除或改写。
- 首轮 E2E 的 CSP 断言错误地要求动态加载的 Turbopack HMR 外部脚本也携带 nonce；DOM 证据表明所有内联执行脚本均有 nonce，动态 HMR 由 `strict-dynamic` 信任链加载，生产不存在。断言收窄到真实攻击面后，冷启动全套 14/14 通过。
- 首轮并发 E2E 在复用已运行 API 时耗尽内存登录限流桶；冷启动 API 后 14/14 通过。独立单元测试另验证第 6 次同 IP 登录被 429 拒绝。
- 代码复查保留逐请求 nonce，接受页面动态渲染成本；不以 `unsafe-inline` 脚本或实验 SRI 换取静态输出。上传/媒体 origin 分离，避免严格 CSP 意外阻断 OSS 直传。
- 最终复查补上已签发 PUT 在取消后迟到落盘的竞态：30 分钟宽限后首扫、24 小时后二扫，连续两次成功才完成，并让完成回调与取消共享 advisory lock。该修正通过 TypeScript、数据库 4/4 与 API/PostgreSQL 24/24 针对性验证；随后用户明确要求不再测试并直接提交，因此整仓 `pnpm check`、全量 E2E、容量与备份恢复没有在这一最终修正后再次执行。

## 4. 仍未验证或未授权

- **Unverified**：真实香港 2C2G 主机的 Web/API/PostgreSQL/容器合计资源、持续 500 连接、磁盘和 OOM 曲线。本机固定两核结果不能替代 2GiB cgroup/真实主机试验。
- **Unverified**：iOS/Android 微信、Safari、移动 Chrome/Edge 的 Service Worker、IndexedDB、内存回落、后台恢复、nonce CSP、抽屉/键盘和弱网行为。
- **Unverified**：VoiceOver、NVDA 与真实辅助技术；axe 和自动键盘断言不能替代人工检查。
- **Unverified / 自动候选保持 `experimental`**：已有 813 张本地照片，但没有逐号码/四边形真值标注，不能计算召回率、负样本错误候选或候选中位数；学校正式评测授权及桌面/移动/Safari OCR p95 门禁也未完成。
- **Unverified**：真实 OSS V4、multipart abort、CDN 鉴权/刷新/缓存、精确上传 origin、账单、DNS、证书、香港部署及真实备份 Bucket。没有创建或修改任何云端、DNS、CI 或生产资源。
- 完整审计的两条 `image-size` 公告只经 Storybook 开发依赖到达且暂无上游修复；生产依赖审计为 0，故事图片仍受专用生成夹具门禁。升级后必须重新审计。
