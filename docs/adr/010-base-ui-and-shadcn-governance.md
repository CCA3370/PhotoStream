# ADR-010：新 UI 基础采用 Base UI 与固定 shadcn 治理

状态：Accepted
日期：2026-08-27

## Context

ADR-009 在 2026-08-26 选择 Radix UI 作为 shadcn/ui 原语基座。随后按当前 shadcn 规范复核发现：Base UI 已成为新项目默认并被官方推荐，Radix 仍受支持但更适合保留在已有稳定项目中。PhotoStream 尚处于 Phase 0，没有 `package.json`、`components.json` 或生成组件，因此改变基座没有迁移成本。

产品需要移动端 Drawer、Dialog、Select、ToggleGroup、Sidebar、批量表单和高密度状态界面，同时要求公共相册保持定制、客户端边界小、微信 WebView 可用。仅记录“使用 shadcn/ui”不足以保证生成结果一致；base、style、图标、Token、aliases、registry 和 CLI 更新流程必须在首次生成组件前确定。

## Decision

- 本 ADR 修订 ADR-009：新 UI 基座使用 Base UI，不再以 Radix 作为默认原语。ADR-009 其余决定继续有效。
- shadcn/ui 只初始化在唯一 UI 消费者 `apps/web` 中；组件源码位于 `apps/web/src/components/ui`，项目组合组件位于 `apps/web/src/components`。首版不创建 `packages/ui`，避免为单一消费者增加第二套 `components.json`、跨包 RSC 边界和发布责任。
- `apps/web/components.json` 固定以下意图：`base=base`、`style=base-nova`、`rsc=true`、`tsx=true`、`rtl=false`、`iconLibrary=lucide`、`tailwind.baseColor=neutral`、`tailwind.cssVariables=true`、空 class prefix、`registries={}`。Tailwind v4 时 `tailwind.config` 为空，样式入口为 `src/app/globals.css`；preset 不得增加第三方字体，继续使用产品规定的系统字体栈。
- aliases 固定为：`components=@/components`、`ui=@/components/ui`、`utils=@/lib/utils`、`lib=@/lib`、`hooks=@/hooks`；`@/` 指向 `apps/web/src`。实际初始化后必须通过 `shadcn info --json` 读回验证，不依赖人工猜测路径。
- Nova 只提供紧凑组件结构；`docs/06-frontend-ux.md` 中的颜色、字体、间距、圆角和响应式规则是产品规范，生成器默认主题不得覆盖。颜色在 `src/app/globals.css` 中以等价 OKLCH 语义变量实现。
- 图标固定使用 Lucide 的项目依赖并打包为内联 SVG，不使用图标 CDN。组件读取图标组件对象，不用字符串映射；Button 内图标使用 `data-icon`，不添加组件已经管理的尺寸类。
- Base UI 的自定义 trigger 使用 `render`，不使用 Radix `asChild`。当 `render` 输出非原生 Button 时显式处理 `nativeButton=false`，不得增加无语义包装元素。
- Base UI 项目使用 shadcn `Toast` 组件；不同时安装 Sonner。Toast 只补充结果，错误摘要、字段错误和危险确认仍在页面/对话框内呈现。
- 首次工程化先通过 Tailwind 浏览器门禁，再只生成 Button、Field、InputGroup、Dialog、Drawer、Select、ToggleGroup、Sidebar 和 Toast 作为 Base UI 试验面，在目标微信 WebView、Safari、Chromium、键盘和辅助技术上验证。Base UI 出现无法修复的关键缺陷时，必须新增 ADR 才能整体切换 Radix；不能在产品内长期混用两个 base。
- 每次使用 shadcn CLI 都以 `pnpm dlx shadcn@latest` 执行，并遵循固定流程：`info --json` 确认项目上下文；`search` 查找现有组件；`docs` 获取当前 base 的文档；`add --dry-run`/`--view`/`--diff` 检查文件、依赖和全局 CSS；确认后才 `add`；随后阅读生成文件并执行组件、无障碍和构建检查。
- 不使用 `add --all`。`--overwrite`、preset `apply` 或重新安装组件属于覆盖性操作，必须先展示 `--dry-run`/`--diff` 并取得用户明确批准；已有本地修改通过逐文件 smart merge 保留。
- preset code 视为不透明值，只通过 CLI 的 `preset decode/url/resolve/apply` 操作，不手工解析或拼接 URL。切换 preset 前必须由用户明确选择 overwrite、partial、merge 或 skip；不得把主题调整自动扩大为组件覆盖。
- 默认只使用官方 shadcn registry。官方组件无法满足需求时可以只读搜索社区 registry，但 registry 地址必须由用户明确选择；安装前审查全部文件、依赖、CSS、环境变量和 imports。GitHub registry 固定到完整 commit SHA，不读取移动分支；首版不配置私有 registry、registry token 或自建 registry。

## Consequences

优点：使用当前 shadcn 新项目主路径，避免无实现状态下先选旧默认再迁移；Nova 在后台保持紧凑，公共相册仍由产品 Token 和专用媒体组件控制；Base UI 的 Drawer、Select 和组合 API 可直接支撑移动与高密度表单；CLI 读回、预览和 registry 规则使生成结果、供应链和本地修改可审计。

代价：Base UI 比 Radix 更新，目标微信 WebView 和辅助技术仍需真实验证；团队必须理解 `render`、items、ToggleGroup 数组值等 Base API，而不能复制 Radix 示例。组件源码属于项目，需要跟踪上游差异并维护本地组合规则。

## Rejected Alternatives

- Radix 作为新项目默认：成熟且仍受支持，但当前 shadcn 已推荐 Base UI；本项目没有既有 Radix 投资，缺少承担未来迁移成本的理由。
- Base UI 与 Radix 并存：扩大依赖、事件/焦点语义和组件审查面，无法形成单一基线。
- React Aria 作为默认：同样是受支持 base，但本项目选择 shadcn 当前默认以降低首版决策和维护分叉；若 Base UI 无法满足辅助技术要求可重新评审。
- 首版建立 `packages/ui`：只有一个 Web 消费者，抽成共享包没有复用收益，并增加 monorepo 配置和 RSC 边界。
- 默认启用社区 registry 或复制外部 block：扩大供应链和风格漂移风险；公共相册与上传队列也不能由通用 Dashboard block 代替。

## Revisit When

Base UI 关键组件在支持的微信/辅助技术组合中存在无法修复的问题；出现第二个真实 UI 应用并需要共享组件；Nova 经实际密度测试不能同时服务工作台和公共端；Lucide 无法覆盖所需图标；或官方 shadcn 改变 base、preset、registry 或 CLI 的兼容承诺。
