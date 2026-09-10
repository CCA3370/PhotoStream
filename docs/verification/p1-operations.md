# P1 运维可靠性：运行时可观测性

状态：仓库实现完成；生产部署仍需单独授权。

## 1. 运行时快照

API 在进程内维护一个有界运行时窗口，不引入 Redis、Prometheus、Grafana 或外部日志服务。每个请求只记录开始时间和完成后的聚合结果，不记录正文、Cookie、相册口令、号码、人脸数据、媒体 URL 或访客标识。

管理员可通过内部认证访问：

```text
GET /api/v1/operations/runtime
```

该接口只允许 `admin` 角色，未认证返回 401，非管理员内部账号返回 403。不要把它暴露为 Caddy 公共监控探针，也不要绕过内部会话保护。

快照包括：

- 最近最多 2,048 个普通已完成请求的 p50/p95/p99 延迟；`text/event-stream` 长连接不进入延迟直方图；
- 总请求、当前 in-flight、>=1 秒慢请求和 2xx/3xx/4xx/5xx 计数；
- Node RSS、heap used/total、external、ArrayBuffer 内存；
- PostgreSQL pool 的 total/idle/waiting；
- 当前 SSE 订阅数；
- deletion、analytics cleanup、bib maintenance、face maintenance、bib cleanup 的运行次数、失败、跳过重入、最近开始/完成/失败时间和最近耗时；
- 当前蓝/绿 slot、API 镜像标识和 Node 版本。

蓝绿 compose 会给 API 注入 `PHOTOSTREAM_SLOT` 与 `PHOTOSTREAM_RELEASE`，值来自当前 service 和实际 `${BLUE_API_IMAGE}` / `${GREEN_API_IMAGE}`，不需要额外秘密变量。

## 2. 后台任务防重入

30 秒轮询任务如果上一轮仍在运行，新一轮不会并发进入同一任务，而是增加 `skippedRuns`。持续出现 `skippedRuns` 表明任务耗时已经超过调度间隔，应先检查数据库/OSS/IMM 延迟和积压，不要通过进一步缩短轮询间隔处理。

## 3. 验证

相关变更继续由四路 CI 覆盖：

- Lint / Typecheck / Unit / Build；
- PostgreSQL schema + API integration；
- Deployment contract；
- Chromium smoke。

运行时指标只存在于 API 进程内并受管理员会话保护，不新增公共监控端口、外部指标服务或云端资源。
