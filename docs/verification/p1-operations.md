# P1 运维可靠性：自动备份与运行时可观测性

状态：仓库实现完成后可部署；systemd/OSS 生产启用仍需单独授权。

## 1. 运行时快照

API 在进程内维护一个有界运行时窗口，不引入 Redis、Prometheus、Grafana 或外部日志服务。每个请求只记录开始时间和完成后的聚合结果，不记录正文、Cookie、相册口令、号码、人脸数据、媒体 URL 或访客标识。

管理员可通过内部认证访问：

```text
GET /api/v1/operations/runtime
```

该接口只允许 `admin` 角色，未认证返回 401，非管理员内部账号返回 403。不要把它暴露为 Caddy 公共监控探针，也不要绕过内部会话保护。

快照包括：

- 最近最多 2,048 个已完成请求的 p50/p95/p99 延迟；
- 总请求、当前 in-flight、>=1 秒慢请求和 2xx/3xx/4xx/5xx 计数；
- Node RSS、heap used/total、external、ArrayBuffer 内存；
- PostgreSQL pool 的 total/idle/waiting；
- 当前 SSE 订阅数；
- deletion、analytics cleanup、bib maintenance、face maintenance、bib cleanup 的运行次数、失败、跳过重入、最近开始/完成/失败时间和最近耗时；
- 当前蓝/绿 slot、API 镜像标识和 Node 版本。

蓝绿 compose 会给 API 注入 `PHOTOSTREAM_SLOT` 与 `PHOTOSTREAM_RELEASE`，值来自当前 service 和实际 `${BLUE_API_IMAGE}` / `${GREEN_API_IMAGE}`，不需要额外秘密变量。

### 后台任务防重入

30 秒轮询任务如果上一轮仍在运行，新一轮不会并发进入同一任务，而是增加 `skippedRuns`。持续出现 `skippedRuns` 表明任务耗时已经超过调度间隔，应先检查数据库/OSS/IMM 延迟和积压，不要通过进一步缩短轮询间隔处理。

## 2. 加密备份周期

现有 `database-backup.mjs` 仍是唯一备份格式实现。新的周期脚本只负责编排：

```bash
BACKUP_DIRECTORY=/var/backups/photostream \
DATABASE_URL='postgresql://photostream@postgres:5432/photostream' \
POSTGRES_CONTAINER='photostream-postgres-1' \
BACKUP_ENCRYPTION_PUBLIC_KEY_FILE='/etc/photostream/backup-public.pem' \
pnpm db:backup:cycle
```

每次成功周期执行：

1. 使用仓库现有 `pg_dump -> AES-256-GCM -> RSA-OAEP-SHA256` 流式加密逻辑生成新的 `.pstrbk`，不会生成明文 dump；
2. 生成权限 0600 的 `.manifest.json`，仅含创建时间、加密文件大小、SHA-256 和可取得时的迁移数量；
3. 可选执行北京 OSS 私有上传；
4. 只有当前周期及可选上传全部成功后才执行本地保留清理；
5. 保留最近 14 个不同 UTC 日的日备份，再保留其之前 8 个不同 ISO 周的周备份；同一天多余快照按时间淘汰。

脚本使用独占锁避免手工运行与 timer 重叠。锁超过 6 小时才可自动判定为陈旧；备份目录剩余空间低于 512 MiB 时直接拒绝启动新备份。

## 3. 可选北京 OSS 异地副本

默认：

```text
BACKUP_UPLOAD_DRIVER=none
```

因此仅合并代码不会产生任何 OSS 请求。获得单独云端授权后，可以在服务器的 `/etc/photostream/backup.env` 使用专门 RAM 凭证：

```text
BACKUP_UPLOAD_DRIVER=aliyun
ALIYUN_OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com
ALIYUN_OSS_BACKUP_BUCKET=<private-backup-bucket>
ALIYUN_ACCESS_KEY_ID=<dedicated-backup-key>
ALIYUN_ACCESS_KEY_SECRET=<dedicated-backup-secret>
BACKUP_OSS_PREFIX=photostream/database
```

上传器硬限制为 `https://oss-cn-beijing.aliyuncs.com`，对象设置 `private` ACL，并为加密备份与 manifest 写 SHA-256 元数据。不接受任意 Endpoint，避免备份凭证被配置错误的目标接收。

RAM 策略应只允许目标备份 Bucket/prefix 的 `PutObject`，不要复用主账号 AccessKey，也不要给备份主机 `DeleteObject`。因此代码不会远端自动删除旧备份。远端生命周期规则必须在单独云端授权后配置，建议至少覆盖 8 周恢复窗口；配置前远端对象只增不删。

## 4. systemd 模板

仓库提供：

```text
deploy/systemd/photostream-backup.service
deploy/systemd/photostream-backup.timer
deploy/systemd/backup.env.example
```

模板计划每天 03:20 运行，并增加最多 20 分钟随机延迟，`Persistent=true` 允许服务器错过时间后补跑。service 使用 `UMask=0077`、只读系统/仓库视图和固定 `/var/backups/photostream` 写路径。

生产启用前必须先人工完成以下事项；这些命令不是部署脚本自动动作：

```bash
sudo install -d -m 0700 /var/backups/photostream
sudo install -m 0600 deploy/systemd/backup.env.example /etc/photostream/backup.env
sudo install -m 0644 deploy/systemd/photostream-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/photostream-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start photostream-backup.service
sudo systemctl status photostream-backup.service
# 首次手工备份验证和隔离恢复演练通过后，才执行：
sudo systemctl enable --now photostream-backup.timer
```

复制环境模板后必须替换占位符，并确保 `/etc/photostream/backup.env` 与备份公钥不可被普通用户读取。首次 `start` 应在维护人员在线时执行并检查 manifest、文件权限、日志和磁盘空间。

## 5. 恢复演练与验收

自动备份不能替代恢复验证。至少按季度从保留副本中随机选择一个备份，在不连接生产 OSS/CDN 的 `photostream_restore_*` 隔离数据库运行现有 `pnpm db:restore` 流程，并记录：

- 备份文件 SHA-256 是否与 manifest 一致；
- GCM/RSA 解密与 `pg_restore --list` 是否通过；
- Drizzle migrations、用户/相册/媒体等关键控制面表是否可读；
- 恢复后随机外键关系和最新审计时间是否合理；
- 演练库和临时私钥副本是否按批准销毁。

不要把私钥复制到日常备份主机来“自动恢复测试”。日常主机只持有公钥；私钥继续只在受控恢复环境短时使用。

## 6. 合并前验证

PR 必须继续通过现有四路 CI：

- Lint / Typecheck / Unit / Build；
- PostgreSQL schema + API integration；
- Deployment contract；
- Chromium smoke。

另外 `pnpm lint` 会运行 backup envelope、14+8 retention 和 OSS 签名的确定性 guard。CI 不连接真实 OSS，也不使用生产凭证。
