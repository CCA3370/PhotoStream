# 人脸找图直接开关验证记录

日期：2026-09-07
状态：Pending CI

## 变更目标

- 相册级 `enabled` 是人脸找图唯一产品级启停来源。
- 管理端开关立即提交 `{ enabled }`，不要求保存按钮、近期认证、重新输入密码或 readiness 确认。
- `public` / `password` 访问方式、旧全局 flag、阈值版本、相册生命周期不得成为第二启用门禁。
- 关闭普通开关停止搜索但保留 Dataset/媒体索引；整册索引删除继续作为独立破坏性操作。
- 云端资源和索引状态只作为运行时状态，不篡改 `enabled`。

## 自动化验证

待 PR CI 执行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

CI 结果未完成前，本记录不将实现标记为 Confirmed。

## 未验证范围

- 真实阿里云 IMM / OSS / EventBridge 调用。
- 生产数据库中已有旧 face readiness/deletion 字段的迁移后行为。
- 正在执行 `delete_dataset` 的极端并发情况下立即重新打开开关。
- 移动端真实设备的人脸搜索交互。
