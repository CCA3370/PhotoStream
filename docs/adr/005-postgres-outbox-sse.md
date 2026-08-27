# ADR-005：PostgreSQL outbox 与 SSE 实时更新

状态：Accepted
日期：2026-08-26

## Context

首版目标约 500 名并发观众，香港主机只有 2C2G。平台需要新媒体实时提示和断线恢复，但用户不希望增加 Redis/Tair、消息队列或托管服务。

## Decision

- 发布事务同时写媒体状态和 `LiveEvent` outbox。
- PostgreSQL `LISTEN/NOTIFY` 只负责唤醒；事件权威记录在表中。
- Fastify SSE 推送轻量事件，使用单调 ID 和 `Last-Event-ID` 重放。
- SSE 不可用时客户端 15 秒轮询增量接口。
- 不引入 Redis、Tair、Kafka 或云消息服务。

## Consequences

单机依赖少、事件不因 API 重启丢失，满足当前容量；代价是 PostgreSQL 同时承担业务和事件查询，多实例扩展前需验证连接与通知行为。

## Rejected Alternatives

- WebSocket：双向能力无必要，代理与微信后台行为更复杂。
- 纯内存事件：API 重启或断线后无法补发。
- Redis Pub/Sub：新增服务与运维成本，且 Pub/Sub 本身不持久。
- 高频轮询：增加 API/数据库请求和更新延迟。

## Revisit When

持续连接或事件吞吐超出压力预算、需要多地域实例，或 PostgreSQL 事件负载影响业务查询。
