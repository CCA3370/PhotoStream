# 阶段 4 号码牌闭环验证记录

状态：本地手工闭环与合成图片 Chromium OCR 已实现并通过自动验证；自动候选正式资格、真实设备、授权样本和云端资源未验证
日期：2026-08-29

## 1. 实现范围

- 共享规则引擎：1–12 位字符串号码、前导零、模式 OR、约束 AND、任意位置、多闭区间、重叠约束可满足性、区间规范化、全角数字/空白规范化和不做字母猜测；规则与映射版本只因有效语义变化递增，纯改名/排序不触发重算；
- 年级/班级映射：不可变选项 ID、显示名与排序、位置/区间到选项、冲突与越界拒绝、同一号码确定性派生；年级+班级查询在同一标签上匹配，不跨多号码照片拼接；
- 持久数据与隐私：号码使用 AES-256-GCM、相册/媒体/标签/密钥版本 AAD、随机 IV、独立数据密钥；精确查询使用相册作用域 HMAC blind index；幂等摘要也使用带域分隔的 keyed HMAC，数据库不保存可枚举的裸号码哈希；
- 状态机与权限：`suggested/confirmed/rejected/needs_review` 标签状态、独立 OCR 活动状态、照片级 `pending/numbers_confirmed/no_number_confirmed/needs_review`；上传者只操作自己照片，审核员/管理员操作全部，批量动作仅审核员/管理员可用；视频拒绝号码操作；
- 人工门禁：OCR 候选、无候选、失败和全拒绝均不自动进入搜索或变成“无号码”；确认无号码拒绝剩余候选且与确认号码互斥；迟到候选不覆盖人工结论；添加号码撤销无号码，删除最后确认号码回到待复核；
- API：完整配置/测试、候选提交、确认/修正/拒绝/删除、手工与批量补录、无号码/撤销/批量、公开精确搜索和属性筛选；全部后台写操作使用内容绑定幂等键，批量返回逐项结果；
- 重算与清理：规则变化立即关闭旧版本公共索引并持久重校验，映射变化持久重算派生属性；失败任务退避并审计；30 分钟未完成 OCR 转失败但保持待复核；相册结束 30 天后清理未解决候选；
- 公开搜索：只允许已解锁口令相册，通过 POST 做精确号码或年级/年级+班级筛选；每个访客会话和每日 IP-HMAC 各自 10 分钟 30 次；无目录、自动补全、模糊匹配、号码回显、URL 参数或含值 SSE；
- 浏览器 OCR：固定 `@paddleocr/paddleocr-js@0.4.2`、`onnxruntime-web@1.24.3`、PP-OCRv6 tiny 检测/识别模型；1920 工作图进入单并发 Worker，480/960 上传与发布不等待 OCR；浏览器先用共享规则过滤/去重/取 8 条，服务端再次验证；
- 资源供应链：模型、Worker、OpenCV、ONNX Runtime WASM 全部同源哈希路径，自托管地址显式传入，生成产物移除 Paddle/JsDelivr 远程回退；18 文件逐项 SHA-256/字节检查、每设备 gzip 预算、immutable 缓存头和第三方许可文本均纳入门禁；
- UI：Base UI + `base-nova` 规则/映射编辑器、当前编辑内容逐条件测试、上传/审核独立 OCR/复核/标签状态、等比候选框覆盖与显隐、批量部分失败保留、公开号码/属性互斥模式；通用可横向滚动表格补齐 Safari 键盘访问；
- 资格门禁：新增 `disabled/experimental/qualified` 自动 OCR 发布状态；当前默认 `experimental`，页面明确说明尚未完成 200 张授权样本与设备门禁；`disabled` 由 API 强制禁止启动自动识别，但手工标签与搜索不受自动候选资格影响。

## 2. 新鲜证据

| 层 | 命令/动作 | 结果 | 状态 |
| --- | --- | --- | --- |
| 可复现安装 | `pnpm install --frozen-lockfile` | 7 个 workspace，锁文件供应链策略通过且无需变更 | Confirmed |
| 全仓门禁 | `pnpm check` | OCR/Storybook 防护、Biome 193 文件、6 个 workspace 类型检查、46 项单元/契约测试、6 个生产构建全部通过；Next 生成全部预期路由 | Confirmed |
| 规则与纯逻辑 | contracts tests | 15 项通过，覆盖前导零、合并区间、OR/AND/重叠冲突、12 位无解、映射冲突/越界、OCR 规范化、重复 ID 和失败活动拒绝候选 | Confirmed |
| 数据库集成 | DB integration | UUIDv7、唯一约束和会话级联 2 项通过 | Confirmed |
| API/隐私/事务 | API integration | 18 项通过；含规则/映射版本、纯改名/重排 no-op、模型/规则过期、processing 回收、手工-only 模式、权限、状态机、批量部分失败、30 天清理、同标签筛选、双重限流、严格 OpenAPI 和无图片正文 | Confirmed |
| 空库迁移 | 专用 `photostream_stage4_verify_0829` 空库执行全部迁移 | 0000–0009 共 10 条迁移成功，得到 26 张 public 表；模型默认值为哈希版本；读回后删除临时库 | Confirmed |
| 旧数据升级 | 开发库执行 0009 并读回 | 旧占位模型版本计数 0，哈希版本相册 85；只定向替换旧占位值 | Confirmed |
| 容量回归 | API capacity | 5,000 媒体、84 页，分页 p95 4.29ms；500 SSE p95 146.5ms | Confirmed |
| OCR 资源 | `node scripts/check-bib-ocr-assets.mjs` | 18 文件哈希/字节/远程回退检查通过；WASM gzip 12,591,182 bytes，WebGPU gzip 15,234,771 bytes，均低于 35 MiB | Confirmed |
| 浏览器号码闭环 | Playwright + Windows Headless Chrome 151 | 合成 960×640 数字图片本地 OCR、processing、上传完成、人工确认、年级/班级、口令搜索、刷新清空、同源资源、immutable 响应头、无号码 URL 和两个 axe 页面通过 | Confirmed |
| 浏览器全回归 | Playwright + Windows Headless Chrome 151 | 冷启动限流状态下 13/13 通过；阶段 1–3 登录、上传/续传/分片/取消、审核/下载/删除/口令轮换、权限、5,000 项 DOM 和 axe 同时通过 | Confirmed |
| 组件 | Storybook build | 2,462 模块；规则编辑、候选/无号码、公开搜索及既有业务状态静态构建成功 | Confirmed |
| UI 基线 | `shadcn info --json` 与官方组件 docs | Next 16.3.3、Tailwind v4、Base UI、`base-nova`、Lucide、RSC/TSX；Field/Select/ToggleGroup/Card/Button 用法复核通过 | Confirmed |
| 号码明文 | 开发数据库只读扫描 | `media_bib_tags`、`audit_logs`、`operation_requests`、`live_events` 对 101999/102999/103999 的明文匹配均为 0 | Confirmed |
| 公共包体 | Next client manifest 扫描 | 公共 `/g/[slug]` manifest 不引用含 OCR 版本/运行时标记的两个客户端 chunk；OCR 仅在启用识别后的上传操作动态加载 | Confirmed |
| 生产依赖 | `pnpm audit --prod` | 无已知生产依赖漏洞 | Confirmed |
| 全依赖公告 | `pnpm audit` | 仅保留 2 条无修复版本的 Storybook-only `image-size@2.0.2` 高危公告 | Partial |
| 秘密/空白/体积 | 凭据模式、私钥、`git diff --check`、单文件大小扫描 | 未发现提交的 E2E 密码、号码密钥、私钥或空白错误；OCR 目录无大于 95 MiB 单文件 | Confirmed |

全依赖审计保留 `GHSA-w3rx-r6r6-pgpr` 与 `GHSA-5p2g-fcmc-qvqq`，路径仍仅为 `@storybook/nextjs-vite → vite-plugin-storybook-nextjs → image-size@2.0.2`，且上游无修复版本。Storybook 仅用于本地开发，构建前的图像输入防护继续拒绝 ICNS、JXL、HEIF/HEIC 和 AVIF；这不等价于上游修复，因此保持 **Partial**。

失败与复查记录：首次真实 OCR 因本机 IDM 错误接管模型/运行时下载而超时；用户关闭 IDM 后约数秒完成。E2E 随后修正同名历史上传的定位器、React hydration 时序和多轮本机限流污染。axe 发现主按钮悬停对比度 4.48:1 与横向表格 Safari 键盘访问问题，均修复后全套通过。全仓 Biome 最初扫描上游压缩 ORT/worker 并改写一个文件；生成资产随后从锁定依赖重建/恢复，Biome 精确排除 vendored 目录，由专用 manifest 门禁取代。代码级复查还补齐规则版本冲突、自动候选资格、processing 过期回收、修正前后审计关系、keyed 幂等摘要、跨标签筛选、模型远程回退、许可通知、候选框坐标和语义版本 no-op。最终所有窄测试、真实 PostgreSQL 集成、Storybook、冷启动浏览器全回归和 `pnpm check` 均重新通过。

## 3. 未验证与限制

- **Unverified / 自动候选保持 experimental**：未获得 Git 外的至少 200 张学校授权评测照片（120 清晰、40 困难、40 背景数字负样本），因此没有召回率 ≥90%、负样本平均错误候选 ≤1、候选中位数 ≤3 或阈值校准证据；
- **Unverified**：桌面 Chromium 暖机推理 p95 ≤3 秒、移动/Safari WASM p95 ≤8 秒；本记录只证明单张合成图闭环成功，不能把整条 E2E 用时当作纯推理基准；
- **Unverified**：Windows/macOS Chrome/Edge WebGPU、iOS Safari、Android/iOS 微信 WebView、移动内存回落、后台/前台和真实触摸/键盘行为；
- **Unverified**：VoiceOver、NVDA 与真实辅助技术；axe、焦点断言和键盘滚动自动化不能替代人工验收；
- **Unverified**：真实阿里云 OSS/CDN 的模型上传、CORS、immutable 缓存、长缓存命中、账单和无第三方请求；本记录只验证本机同源 Next 静态资源；
- **Unverified**：号码数据/搜索密钥轮换、备份隔离恢复与旧/新双版本查询；这些属于阶段 6 加固，当前只实现单当前版本和持久 `keyVersion`；
- **Unverified**：学校对号码用途、隐私说明、授权样本、删除流程与复核责任人的确认；所有自动化使用非人物合成图和虚构号码；
- 阶段 5–7 的视频闭环、完整安全性能加固与部署不由本记录声明完成；没有创建或修改 DNS、OSS、CDN、香港主机、CI 发布或任何生产资源。
