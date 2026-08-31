# 运维、备份与事件响应手册

状态：本地可执行基线；生产执行需单独授权
更新日期：2026-08-30

## 1. 范围与硬边界

本手册覆盖 PostgreSQL 加密备份/隔离恢复、应用密钥轮换、孤立上传清理、内容安全事件和 CDN 域名迁移。它不授权部署、DNS、OSS/CDN 或生产数据操作；执行者必须先记录目标环境、批准人、时间、回滚点和输出位置。

备份只包含香港控制面元数据。照片正文仍位于杭州私有 OSS，不通过备份脚本或香港 HTTP 服务传输。

## 2. 生成备份收件人密钥

在受控离线位置生成至少 3072 位 RSA 密钥；日常备份主机只持有公钥，私钥只在隔离恢复时临时提供：

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /secure/photostream-backup-private.pem
openssl pkey -in /secure/photostream-backup-private.pem -pubout -out /secure/photostream-backup-public.pem
chmod 600 /secure/photostream-backup-private.pem /secure/photostream-backup-public.pem
```

不得把密钥放入仓库、镜像、日志或命令行参数。轮换备份密钥时，新备份立即改用新公钥；所有仍在保留期内的旧备份销毁前必须继续安全保存对应旧私钥。

## 3. 创建加密数据库备份

输出必须是仓库外的绝对 `.pstrbk` 路径，且目标不得已存在：

```bash
DATABASE_URL='postgresql://...' \
BACKUP_ENCRYPTION_PUBLIC_KEY_FILE='/secure/photostream-backup-public.pem' \
pnpm db:backup -- --output '/approved-backup/photostream-YYYYMMDD-HHMMSS.pstrbk'
```

当 PostgreSQL 客户端只存在于容器时，额外设置精确容器名 `POSTGRES_CONTAINER`。工具以 `pg_dump --format=custom --no-owner --no-privileges` 输出流为输入，使用随机 AES-256-GCM 数据密钥加密，再以 RSA-OAEP-SHA256 包装数据密钥；数据库转储不会以明文文件落盘。失败时删除未完成输出。

完成后记录文件大小、SHA-256、创建时间、数据库迁移数和存放责任人。保留策略为 14 个日备份和 8 个周备份；删除旧备份必须按明确清单执行。

## 4. 隔离恢复演练

1. 在不连接生产 CDN/OSS 的 PostgreSQL 实例中创建空库，名称必须匹配 `photostream_restore_<标识>`。
2. 临时提供对应私钥，并运行：

```bash
RESTORE_DATABASE_URL='postgresql://.../photostream_restore_YYYYMMDD' \
BACKUP_DECRYPTION_PRIVATE_KEY_FILE='/secure/photostream-backup-private.pem' \
pnpm db:restore -- --input '/approved-backup/photostream-YYYYMMDD-HHMMSS.pstrbk'
```

3. 工具先验证目标为空，再把通过 GCM 认证的转储解密到权限 `0600` 的临时目录；`pg_restore --list` 通过后，以 `--single-transaction --exit-on-error` 恢复。无论成功失败都删除临时明文。
4. 自动检查公共表和迁移记录；人工再比对关键表计数、最新审计时间和随机外键关系。不得在恢复库启动 Web/API、签发 CDN URL 或处理真实照片。
5. 保存不含秘密/号码/媒体地址的演练证据，随后按批准删除恢复库和临时私钥副本。

恢复工具拒绝非隔离命名、非空目标、篡改备份、错误私钥和部分失败；不提供绕过开关。真正灾难恢复到生产名称必须使用单独、人工评审的流程，不能把隔离演练命令直接改名执行。

## 5. 应用密钥轮换

### 5.1 会话密钥

1. 将旧 `SESSION_SECRET_CURRENT` 放入 `SESSION_SECRET_PREVIOUS`，生成新的 current 并重启 API。
2. 新会话只用 current；旧会话在原绝对有效期内可用 previous 验证。
3. 至少等待最长 7 天绝对会话期并确认旧会话归零，再删除 previous。疑似泄漏时不保留重叠窗口，立即吊销数据库会话并强制重新登录。

### 5.2 号码加密/搜索密钥

`BIB_DATA_KEY*` 用于号码 AEAD，`BIB_SEARCH_KEY*` 用于 blind index 和隐私化幂等摘要，`BIB_KEY_VERSION*` 只是对应关系标识。三项 previous 必须成组设置：

1. 先创建加密备份；把旧 current 三项复制为 previous，并配置全新的 current 数据密钥、搜索密钥和版本。
2. 启动时 API 会读取数据库中的所有 `key_version`；缺任一所需版本会拒绝启动。
3. 重叠期内新写入只用 current，读取、精确搜索和幂等重试同时接受 current/previous；后台每轮最多重加密 200 条。
4. 观察 `select key_version, count(*) from media_bib_tags group by key_version`，直到只剩 current；再等待 30 天旧幂等请求保留窗口结束后删除 previous。后台每日删除超过 30 天的隐私化操作摘要、过期会话，以及已结束/归档相册的旧 SSE 事件；直播中相册事件不裁剪。
5. 轮换期间不得修改号码规则来掩盖解密/搜索错误，也不得把号码明文导出到脚本或日志。

### 5.3 其他秘密

- CDN URL 鉴权先配置主/备重叠，验证新 key 后再撤销旧 key；需要云端授权。
- OSS RAM AccessKey 采用新建受限凭证、验证、切换、撤销旧凭证的顺序；不得使用主账号 key。
- CSRF、游标、访客会话和统计 HMAC 密钥没有双读协议；轮换会使对应临时状态失效，应在维护窗口执行并明确影响。

## 6. 上传清理与后台任务

- 用户取消后，上传意图进入 `cancelled + pending`；过期 active 意图进入 `expired + pending`。首轮清理至少等待 30 分钟，覆盖 15 分钟签名与在途请求落盘窗口。
- 后台先终止每个 multipart，再删除未发布对象；24 小时后执行第二次确认清理，连续两次成功才标记 `completed`，防止较晚完成的已签名 PUT 重新制造孤立对象。失败写 `cleanup_last_error_code` 并以 1 分钟起步、最高 1 小时退避重试。
- 已发布或待审核的已验证 480/960 预览不得因后续原图取消而删除；只清理未验证/未发布对象并恢复权威完整度。
- 可用以下只读查询检查积压：

```sql
select status, cleanup_status, count(*)
from upload_intents
group by status, cleanup_status
order by status, cleanup_status;
```

不得直接删数据库行来“清队列”；先确认对象与 multipart 状态，再让持久任务重试。

## 7. 内容安全与账号事件

1. 立即记录事件 ID、发现时间、相册/照片随机 ID 和负责人，不复制照片、口令、签名 URL 或号码到聊天/工单。
2. 误发照片先隐藏；管理员近期重新登录后请求永久删除。只有 OSS 对象删除、CDN 刷新和号码密文/复核记录清理全部成功，任务才标记完成。
3. 账号疑似泄漏时先停用账号并吊销会话，再检查仅含动作摘要的审计；按影响轮换相册口令和相关密钥。
4. 签名 URL/OSS 凭证泄漏时撤销或轮换凭证、检查对象范围与账单；不得临时把 Bucket 改公共读。
5. 临时提高日志级别前写明字段、期限和责任人；仍不得记录请求正文、Cookie、号码、原始 IP、完整 URL 或密钥。
6. 关闭事件前验证隐藏/删除、会话吊销、密钥切换、费用与学校通知流程，并记录仍未确认的外部影响。

## 8. CDN 域名迁移

数据库只保存 object key。迁移前先在获批的新域名配置私有回源、URL 鉴权、照片路径缓存和 HTTPS；将 Web/API 的 `MEDIA_BASE_URL` 同步改为新 origin（严格 CSP 会据此只允许该唯一媒体 origin），并把 `PHOTO_UPLOAD_BASE_URL` 固定为精确 OSS 上传 origin。小流量验证后才切 DNS/分享入口。旧域名保留到最长页面/签名缓存窗口结束，再撤销鉴权与源站访问。

域名迁移不得改写数据库 object key、代理照片经过香港、启用云端图片处理或顺带创建其他阿里云产品。
