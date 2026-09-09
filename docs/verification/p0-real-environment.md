# P0 真实环境与端侧交付验收

状态：**代码与只读检查入口已完成；真实设备/真实活动执行仍为 Unverified**

本记录对应当前 P0：恢复主分支质量门禁、建立浏览器媒体交付/CDN 观测闭环，并把真实部署与真机小流量验收整理为可重复步骤。本文不授权创建、修改或删除任何 OSS、CDN、DNS、证书或生产资源。

## 1. 自动只读 smoke

生产环境部署完成后，在任意可访问生产域名的机器执行：

```bash
PHOTOSTREAM_SMOKE_BASE_URL='https://photos.example.edu' pnpm smoke:production
```

检查项：

- `/api/v1/health/live` 返回 200 和 `status=ok`；
- `/api/v1/health/ready` 返回 200 和 `status=ok`；
- 首页可访问，并存在 HSTS、CSP、`nosniff`、frame deny、Referrer-Policy、Permissions-Policy；
- `/sw.js` 明确 `no-cache` + `no-store`；
- 全程仅 GET/HEAD，不创建或修改业务/云端资源。

若已经取得一条当前有效的派生图 CDN URL，可额外执行：

```bash
PHOTOSTREAM_SMOKE_BASE_URL='https://photos.example.edu' \
PHOTOSTREAM_SMOKE_MEDIA_URL='<current signed derived-image URL>' \
pnpm smoke:production
```

脚本不会打印该 URL，只使用 HEAD 验证应用 Origin 的 CORS 与媒体 Cache-Control。不要把签名 URL 写入仓库、Issue 或 CI 日志。

## 2. 浏览器媒体交付验收

新 telemetry 只按相册聚合以下数据，不记录媒体 ID、签名 URL、相册口令、号码、人脸参考照或访客标识：

- 内存缓存命中次数/字节；
- CacheStorage 命中次数/字节；
- 并发请求合并次数；
- 网络媒体请求次数/成功读取字节；
- CacheStorage 读写失败、大小不一致、淘汰；
- 签名 URL 刷新；
- 自定义缓存失败后直接显示 CDN URL 的 fallback 次数。

事件在浏览器会话内聚合，约 10 秒或累计 24 个事件后批量提交；页面离开时使用 keepalive 尝试提交最后一批。明细只保留 30 天，并与现有 Dashboard 时间范围一致。

### 建议验证流程

1. 选择一个测试相册，浏览器开发者工具禁用网络缓存的选项必须关闭；不要清除 PhotoStream CacheStorage。
2. 首次进入相册，连续打开并左右切换约 10 张照片，等待至少 10 秒。
3. 返回网格，再次打开并切换同一批照片，再等待至少 10 秒。
4. 打开管理 Dashboard，同一时间范围查看“CDN 资源监控 → 浏览器媒体交付”。
5. 第二轮应明显增加“本地命中/缓存复用量”；在没有缓存淘汰或失败时，同一批照片的网络取图增长应显著低于第一轮。
6. 阿里云 CDN 数据存在采集延迟，最终下行流量以阿里云统计为准；浏览器 telemetry 用于解释请求来源和重复加载原因，不冒充账单数据。
7. 若 direct fallback、read/write failure 或 size mismatch 持续增长，先定位缓存兼容性，再调整缓存预算，不要仅扩大 CacheStorage 上限掩盖问题。

## 3. 真机最小矩阵

每个环境至少完成一次“打开相册 → 首图 → 打开灯箱 → 连续滑动 10 张 → 操作工具栏 → 关闭灯箱 → 再次打开同一批照片”。

| 环境 | 必测项 | 当前证据 |
| --- | --- | --- |
| Android Chrome | 基准加载、滑动、缓存复用、下载菜单 | Unverified |
| Android 微信 WebView | 滑动后按钮立即可点、抽屉关闭无闪烁、缓存复用 | Unverified |
| iOS Safari | CacheStorage、手势/缩放、Fullscreen 能力降级、返回恢复 | Unverified |
| iOS 微信 | 灯箱、输入焦点、找照片抽屉、缓存复用 | Unverified |
| 较弱 Android 设备 | 连续滑动帧率、图片 decode、内存压力 | Unverified |
| 校园 Wi-Fi | 首屏、连续浏览、CDN 命中、SSE 恢复 | Unverified |
| 蜂窝网络 | 弱网加载、签名刷新、失败恢复 | Unverified |

### 通过标准

- 相邻图片只有在明确滑动意图后才可能发起目标图网络请求；
- 已缓存的同规格照片再次打开不应重复从 CDN 下载；
- 滑动完成后关闭、全屏、点赞、查看原图、下载等按钮立即可操作；
- 关闭“找照片”抽屉无白缝、虚化闪烁或布局跳变；
- 原图只在用户明确点击查看/下载原图时请求；
- 任一设备出现缓存读写失败时仍能 direct fallback 显示，不因 telemetry 失败影响图片可用性；
- 后台浏览器媒体交付统计能解释测试期间的命中、网络请求和异常计数。

## 4. 证据记录

真实执行后，把以下信息追加到本文件或新建带日期的验证记录：

- Git SHA 与实际 blue/green slot；
- 执行时间、设备/OS/浏览器或微信版本；
- `pnpm smoke:production` 结果；
- 测试相册照片数量和测试步骤，不记录相册口令或学生身份信息；
- Dashboard 浏览器媒体交付聚合值；
- 同时段 CDN 流量/回源/命中率（注明阿里云统计延迟）；
- 失败项、复现步骤和对应 request ID（如有）。

只有完成对应真实环境执行后，才能把该环境从 **Unverified** 升级为已验证。
