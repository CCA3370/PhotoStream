# Debian 13 完整部署操作手册

状态：部署代码已完成并通过本地检查；目标主机、云资源与生产运行仍需现场验证

适用版本：PhotoStream `main` 分支，Debian 13，Docker Compose 蓝绿部署

最后更新：2026-09-02

## 1. 文档目标与边界

本手册供未参与开发的运维人员完成以下工作：

1. 准备香港 Debian 13 服务器和杭州阿里云媒体数据面；
2. 从任意目录运行单个部署脚本，由脚本自动克隆仓库并通过交互输入全部外部配置；
3. 验证 PostgreSQL、Fastify、Next.js、Caddy、HTTPS、OSS 直传和 CDN 读取；
4. 后续在不停止当前服务的情况下更新到配置分支最新提交；
5. 执行配置变更、应用回滚、日常巡检和常见故障排查。

脚本会安装或复用 Docker Engine/Compose、自动生成应用内部密钥、生成运行环境文件、构建镜像、迁移数据库并启动服务。操作人员不需要也不应手工编辑 `.env`。

脚本不会替用户创建或修改 DNS、安全组、OSS、CDN、RAM、IMM、EventBridge、学校账号审批或生产备份调度。执行任何云端或生产操作前，必须有明确授权并记录目标、执行人、时间和回滚点。

## 2. 部署拓扑与资源预算

部署由一个持久数据库和两组可切换应用槽组成：

```text
互联网
  │ 80/443
  ▼
Caddy ── 当前活动路由 ──► Web blue/green (Next.js :3000)
  │
  └── /api/* ──────────► API blue/green (Fastify :3001)
                              │
                              ▼
                       PostgreSQL 18.6

浏览器 ── 预签名 PUT ──► 杭州私有 OSS
浏览器 ◄─ 鉴权 URL ──── 内地 CDN ◄── 私有 OSS
```

服务不会发布 PostgreSQL、API 或 Web 容器端口。公网只监听 80/TCP、443/TCP 和 443/UDP；照片正文直接在浏览器、OSS 和 CDN 之间传输，不经过香港 Web/API/PostgreSQL。

| 组件 | 单实例内存上限 | CPU 上限 | 持久数据 |
| --- | ---: | ---: | --- |
| PostgreSQL | 512 MiB | 1.25 | `photostream_postgres-data` |
| Caddy | 96 MiB | 0.5 | `photostream_caddy-data`、`photostream_caddy-config` |
| 每个 API 槽 | 320 MiB | 1.25 | 无 |
| 每个 Web 槽 | 320 MiB | 1.25 | 无 |

更新期间新旧应用槽会短暂并存。2 GiB 主机建议允许脚本创建 2 GiB `/swapfile`，镜像按 API、Web 顺序串行构建。

## 3. 上线前必须准备的内容

### 3.1 授权与责任

部署前先完成并保存以下记录，但不得把秘密写进 Git、聊天或工单：

- 获准操作的服务器、DNS、OSS、CDN 和 RAM 资源精确清单；
- 主站 DNS 与 CDN CNAME 的实际执行人；
- 当前 DNS/CDN 配置截图或导出、预期回滚值；
- 首次云端冒烟允许使用的测试相册、测试对象和最大流量；
- 费用提醒和安全事件联系人；
- 数据库加密备份、主机快照和恢复演练负责人；
- 学校隐私说明、未成年人影像授权、删除与投诉流程。

完整组织输入见[部署前待提供信息](deployment-inputs.md)。未获得人脸处理、云资源、跨境评估和授权样本批准时，首次部署必须选择关闭人脸候选找图。

### 3.2 服务器要求

| 项目 | 必须满足 |
| --- | --- |
| 系统 | Debian 13，不能用 Ubuntu、Debian 12 或其他发行版冒充 |
| 架构 | `amd64` 或 `arm64` |
| CPU | 至少 2 vCPU |
| 内存 | `/proc/meminfo` 至少约 1.8 GiB，目标为 2 GiB |
| 磁盘 | 仓库所在文件系统至少 8 GiB 可用；生产还需为数据库、镜像、日志和备份预留增长空间 |
| 权限 | 可通过 `sudo` 获得 root；SSH 私钥不放进仓库 |
| 时间 | NTP 正常；服务器建议使用 UTC，业务显示由应用处理 |
| 入站 | 22/TCP 仅允许受控来源；80/TCP、443/TCP、443/UDP 公网可达 |
| 出站 | 可访问 Git remote、Docker apt/镜像仓库、ACME CA、杭州 OSS 和阿里云 CDN API |

在服务器执行只读检查：

```bash
cat /etc/os-release
dpkg --print-architecture
nproc
free -h
df -h /
timedatectl status
sudo ss -lntup
```

预期 `VERSION_ID="13"`，架构为 `amd64` 或 `arm64`，CPU 不少于 2。首次部署前 80/443 不应被未经计划的 Nginx、Apache 或其他服务占用。

云厂商安全组和主机防火墙应只按批准开放端口。不要开放 3000、3001、5432 或 Caddy 管理端口 2019。

### 3.3 主站 DNS 与 HTTPS

准备一个主站域名，例如 `photos.example.edu`：

1. 创建 A 记录指向香港服务器公网 IPv4；
2. 只有服务器确实有可用公网 IPv6 时才创建 AAAA；
3. 确认 80/443 可从公网访问，Caddy 需要它们完成自动 HTTPS；
4. 邮箱用于 ACME 到期/异常通知；
5. 不要把 CDN 域名作为主站域名，主站/API 必须同源。

在部署机和另一网络分别检查：

```bash
getent ahosts photos.example.edu
```

若主机已安装 `dnsutils`，可进一步区分 A/AAAA 记录：

```bash
dig +short A photos.example.edu
dig +short AAAA photos.example.edu
```

如果 DNS 尚未传播，脚本可以完成容器启动，但最后的公网 HTTPS 冒烟会失败。DNS 修复后重新运行 `sudo bash /opt/photostream/deploy/deploy.sh update` 即可自愈，不需要重新输入配置。

### 3.4 杭州 OSS 媒体 Bucket

按[阿里云 OSS/CDN 配置](08-aliyun-cdn-oss.md)创建或确认媒体 Bucket：

| 配置 | 目标值 |
| --- | --- |
| 地域 | 华东 1（杭州） |
| 存储类型 | 标准存储 |
| ACL | 私有 |
| 版本控制 | 关闭 |
| 传输加速/跨区域复制/静态网站 | 关闭 |
| 图片处理/通用数据索引/日志转存 | 关闭 |
| Multipart 生命周期 | 终止超过 1 天仍未完成的上传 |

上传 CORS 规则必须使用主站的精确 Origin，例如 `https://photos.example.edu`：

- Method：`PUT`；
- Allowed headers：`Content-Type`、`Content-MD5`、`x-oss-forbid-overwrite` 以及实际签名要求的最小头集合；
- Expose headers：`ETag`、`x-oss-request-id`，实际使用 CRC 时再加入对应响应头；
- Max age：600 秒；
- 不允许 `*` Origin，不开放浏览器匿名 GET、HEAD、DELETE 或对象列举。

应用只允许 `assets/`、`branding/` 和 `media/` 等文档定义前缀。不要把 Bucket 改成公共读，也不要启用 OSS 图片处理。

### 3.5 RAM 应用凭证

创建专用 RAM 用户或等效受限凭证，不能使用主账号 AccessKey。权限仅覆盖：

- 媒体 Bucket 指定前缀的单对象 PUT、multipart 初始化/分片/完成/终止、HEAD 和 DELETE；
- 对应 CDN 文件刷新 API；
- 不允许修改 Bucket ACL/Policy、删除 Bucket、列举无关前缀或访问备份 Bucket；
- 浏览器永远只得到单对象预签名 URL，不得到 RAM/STS 凭证。

部署时需要输入 AccessKey ID 和 Secret。它们只进入 `/etc/photostream/settings.sh` 与 API 专用运行环境文件，不进入 Web/Caddy 容器。

### 3.6 CDN 域名

确认媒体 CDN HTTPS Origin，例如 `https://cdn.example.edu`，不含路径和末尾 `/`。目标配置：

| 配置 | 目标值 |
| --- | --- |
| 加速区域 | 中国内地 |
| 业务类型 | 图片小文件 |
| 源站 | 上述杭州媒体 Bucket 外网 OSS 域名 |
| 私有回源 | 开启；官方服务角色仅可读媒体 Bucket |
| 回源/客户端协议 | HTTPS；HTTP 301 到 HTTPS |
| TLS | 1.2/1.3 |
| QUIC、图片处理、实时日志、DCDN/ESA | 关闭 |

对 `/branding/` 和 `/media/` 配置 Type A URL 鉴权。记录：

- 当前鉴权 Key；
- 可选备用 Key；
- 控制台鉴权有效期，单位秒，必须与脚本输入完全相同；建议当前值 7200 秒；
- CDN 必须先鉴权，再从 Cache Key 中剥离 `auth_key`；
- 未知路径应拒绝或不缓存。

CDN CNAME、备案和 HTTPS 证书必须在首次应用冒烟前完成。不要把 RAM Secret 与 CDN 鉴权 Key 混用。

### 3.7 Git 仓库访问

服务器需要能以 root 身份读取部署分支。首次运行前，只需通过受控渠道把仓库中的 `deploy/deploy.sh` 单独复制到服务器任意位置，例如 `/tmp/photostream-deploy.sh`；不需要人工创建或克隆 `/opt/photostream`。

私有仓库需提前为 root 执行身份配置只读 deploy key、`known_hosts` 或受控凭证助手，并验证：

```bash
sudo -H git ls-remote <仓库地址> refs/heads/main
```

将分支替换为实际值，预期输出对应提交。不要把 token 写入仓库 URL、脚本或 shell history。

脚本固定使用 `/opt/photostream` 作为受管仓库目录：目录不存在或为空时自动克隆；已经是完整 PhotoStream Git 仓库时安全复用；非空但不是完整仓库时立即停止，绝不会删除或覆盖其中内容。脚本启动位置和当前工作目录都不会改变该行为。

## 4. 首次部署

### 4.1 启动命令

在任意目录执行已复制的脚本，例如：

```bash
cd /tmp
sudo bash /tmp/photostream-deploy.sh install
```

脚本先验证 Debian 13/架构/CPU/内存；缺少 Git 时自动安装，然后获取仓库地址和分支，将仓库克隆到 `/opt/photostream`，并用受管仓库内的部署脚本继续执行。随后验证部署文件和磁盘、安装或复用 Docker 官方 Debian 13 软件源。调用者当前目录不会被用作构建上下文，也不会产生部署文件。

如果启动脚本本身位于一个带 remote 的 PhotoStream checkout 中，仓库地址和当前分支会自动继承；单独复制的脚本则会先询问仓库地址和首次克隆分支。完成克隆后，这些值会写入 root-only 记忆配置。发现 `docker.io`、`docker-compose`、`podman-docker`、`containerd` 或 `runc` 等冲突包时，脚本会显示精确列表并要求确认后才替换。已有可用的 `docker compose` 时不会重复安装。

首次安装一旦保存了 `/etc/photostream/settings.sh`，再次执行 `install` 会主动拒绝。若后续构建、迁移、DNS/证书或公网冒烟失败，先按错误修复原因，再执行 `sudo bash /opt/photostream/deploy/deploy.sh update` 续跑；需要修改已保存的输入时执行 `configure`。

### 4.2 交互输入说明

按下表准备值。秘密输入不会回显；重新执行 `configure` 时直接回车可保留现有值。

| 提示 | 输入格式与说明 |
| --- | --- |
| 主站域名 | 仅域名，如 `photos.example.edu`；不要输入 `https://` 或路径 |
| ACME 邮箱 | 可接收到期/异常通知的运维邮箱 |
| 媒体 CDN HTTPS Origin | 如 `https://cdn.example.edu`；必须 HTTPS、无路径、无末尾 `/` |
| 杭州私有媒体 OSS Bucket | 真实 Bucket 名，小写字母/数字/连字符 |
| 应用 RAM AccessKey ID | 专用最小权限凭证；秘密输入 |
| 应用 RAM AccessKey Secret | 与上述 ID 配对；秘密输入 |
| CDN Type A 当前鉴权 Key | 与 CDN 控制台当前 Key 完全一致，至少 16 字符 |
| CDN Type A 备用鉴权 Key | 可选；首次没有则回车跳过 |
| CDN 鉴权有效期 | CDN 控制台的秒数，范围 60–86400；建议 7200 |
| 是否启用人脸候选找图 | 没有全部门禁时选择 `n`；这是推荐和默认选项 |
| 首位管理员用户名 | 3–40 位，ASCII 字母/数字开头，可含 `.`、`_`、`-` |
| 首位管理员展示名 | 1–80 字符，可使用中文 |
| Git 仓库地址 | HTTPS、SSH 或 `git@host:path`；不能含空白，不要嵌入 token |
| Git remote | 通常为 `origin` |
| Git 分支 | 通常为 `main`，必须与当前检出分支一致 |
| 是否创建 swap | 2 GiB 主机建议选择 `y` |

只有明确获准启用人脸功能时，脚本才会继续询问独立人脸 RAM AccessKey、阿里云 UID、杭州 IMM Project、独立参考照 Bucket 和已验证阈值版本。参考照 Bucket 不能与媒体 Bucket 相同，阈值不能填写 `unqualified`。

### 4.3 自动生成的内容

以下值由 OpenSSL CSPRNG 自动生成并长期记忆，不需要人工编写：

- PostgreSQL 密码；
- 会话、CSRF、游标、访客会话密钥；
- 相册口令、用户临时密码派生密钥；
- 分析 HMAC 密钥；
- 号码数据密钥、搜索密钥及版本；
- EventBridge signature token。

不要为了“方便备份”把这些值复制到 Git、聊天或共享文档。必须通过受控主机秘密备份保存 `/etc/photostream/`。

### 4.4 脚本执行顺序

首次部署会按以下顺序执行：

1. 必要时安装 Git、克隆到 `/opt/photostream`，并切换到受管脚本；
2. 保存交互配置到 root-only 文件；
3. 没有 swap 且用户同意时创建精确 2 GiB `/swapfile` 并写入 `/etc/fstab`；
4. `git fetch` 并 `merge --ff-only` 到配置分支最新提交；
5. 串行构建 API 和 Web 镜像；
6. 启动 PostgreSQL 并等待健康；
7. 使用目标 API 镜像执行 Drizzle 数据库迁移；
8. 启动首个蓝槽并等待 API ready 和 Web 健康；
9. 启动 Caddy、申请证书并执行公网 HTTPS ready 冒烟；
10. 创建首位管理员并只显示一次临时密码。

构建和证书签发可能持续数分钟。不要在另一个 SSH 会话重复启动部署脚本；脚本使用 `/run/lock/photostream-deploy.lock` 防止并发部署。

### 4.5 首位管理员

成功输出类似以下信息时，立即通过受控方式记录临时密码：

```text
Created administrator <username>.
Temporary password (shown once): <一次性密码>
The account must change this password at first login.
```

访问 `https://<主站域名>/login`，登录后立即修改密码。不要把临时密码放进截图、工单或群聊。

如果应用已经上线但管理员创建步骤失败，修复错误后直接运行：

```bash
sudo bash /opt/photostream/deploy/deploy.sh update
```

同一提交会检查并自愈活动槽，然后补做未完成的管理员初始化，不会重新询问部署配置。

## 5. 配置和状态文件

| 路径 | 内容 | 权限/说明 |
| --- | --- | --- |
| `/etc/photostream/settings.sh` | 用户输入、Git 仓库地址和自动生成秘密的权威副本 | `root:root 0600`；Bash 转义格式 |
| `/etc/photostream/api.env` | API 所需数据库、RAM、CDN、号码/人脸配置 | `root:root 0600` |
| `/etc/photostream/web.env` | Web 所需公开 origin | `root:root 0600`；不包含数据库/RAM 密钥 |
| `/etc/photostream/caddy.env` | 主站域名和 ACME 邮箱 | `root:root 0600`；不包含应用秘密 |
| `/etc/photostream/compose.env` | Compose 路径、镜像槽和 PostgreSQL 密码 | `root:root 0600` |
| `/var/lib/photostream/deploy-state.sh` | 活动槽、蓝/绿镜像和管理员初始化状态 | `root:root 0600` |
| `/var/lib/photostream/caddy/` | Caddy 当前活动路由片段 | 容器只读挂载 |
| Docker named volumes | PostgreSQL 数据、Caddy 证书/状态 | 不在 Git 中 |

运维人员平时不应直接编辑以上文件。外部值变更使用：

```bash
sudo bash /opt/photostream/deploy/deploy.sh configure
```

输入界面会显示已有非秘密默认值；秘密项回车保留，备用 CDN Key 输入 `-` 才会清空。配置完成后会用同一提交创建新的带时间戳镜像标签，经蓝绿流程发布。

读取秘密文件前必须有明确故障处理需要，避免使用 `cat`、`set -x`、`env` 或会进入 shell history 的命令打印内容。不要把 `/etc/photostream` 直接上传到媒体 OSS Bucket。

## 6. 部署后技术验收

首次部署只有完成本节并留下不含秘密的证据后，才能标记为目标环境已验证。

### 6.1 脚本状态与容器

```bash
sudo bash /opt/photostream/deploy/deploy.sh status
sudo docker compose \
  --env-file /etc/photostream/compose.env \
  -f compose.production.yml \
  --profile blue --profile green ps
```

预期：

- `postgres`、一个 API 槽和一个 Web 槽为 Up/healthy，`caddy` 为 Up；
- 非活动槽为停止或不存在；
- `status` 显示的活动提交等于 `git -C /opt/photostream rev-parse --short=12 HEAD`，配置重发时可带时间戳后缀；
- 没有容器持续重启。

### 6.2 端口与网络边界

```bash
sudo ss -lntup
sudo docker network inspect photostream_internal
```

预期公网只出现计划内 SSH、80、443；不能出现主机监听的 3000、3001、5432、2019。`photostream_internal` 只承载本项目容器。

### 6.3 主站、API 与证书

```bash
curl -fsS https://photos.example.edu/api/v1/health/live
curl -fsS https://photos.example.edu/api/v1/health/ready
curl -fsSI https://photos.example.edu/
openssl s_client -connect photos.example.edu:443 -servername photos.example.edu </dev/null
```

将域名替换为实际值。预期 live/ready 返回 2xx，首页返回 HTTPS 响应，证书域名匹配且链完整。再从手机流量或另一网络访问，避免只验证服务器本机 DNS。

检查 HTTP 会跳转 HTTPS：

```bash
curl -sSI http://photos.example.edu/ | sed -n '1,8p'
```

不要在输出或截图中包含登录 Cookie、签名媒体 URL 或完整请求头。

### 6.4 资源与日志

```bash
free -h
swapon --show
df -h
sudo docker stats --no-stream
sudo docker system df
```

查看最近日志时通过 Compose 服务名，不猜容器名：

```bash
sudo docker compose \
  --env-file /etc/photostream/compose.env \
  -f /opt/photostream/compose.production.yml \
  --profile blue --profile green logs --since 15m --tail 200 postgres caddy
```

应用槽日志可先从 `sudo bash /opt/photostream/deploy/deploy.sh status` 确认活动槽，再把 `api-blue web-blue` 或 `api-green web-green` 加入命令。日志不得出现 Cookie、密码、RAM/CDN Key、号码明文、完整签名 URL 或原始 IP。

### 6.5 数据库

确认数据库只在内部网络、迁移完成并可响应：

```bash
sudo docker compose \
  --env-file /etc/photostream/compose.env \
  -f /opt/photostream/compose.production.yml \
  exec -T postgres psql -U photostream -d photostream \
  -c 'select count(*) as migrations from drizzle.__drizzle_migrations;'
```

如果实际迁移表 schema/name 与 Drizzle 版本不同，先用只读 `\dn`、`\dt *.*` 确认，不要删除表或手工修改迁移记录。

### 6.6 OSS/CDN 小流量冒烟

只使用批准的合成/测试照片和专用测试相册：

1. 管理员创建测试相册和一个临时上传者；
2. 浏览器选择一张无真实学生信息的测试照片；
3. 浏览器网络面板应显示照片派生后直接 PUT 到精确 OSS URL，不能把图片正文 POST 到主站/API；
4. 上传完成后检查 480/960/1920/原图状态、审核、发布和隐藏；
5. 公共相册图片应从 CDN 域名加载；
6. OSS 匿名对象 URL 必须拒绝，预签名 URL 改方法/key/过期后必须失败；
7. CDN 有效 Type A URL 成功，篡改/过期失败，重复访问出现 Age 或缓存命中；
8. 删除测试照片后确认 OSS 对象清理与 CDN 刷新；
9. 检查账单只出现批准的 OSS/CDN 项，不出现图片处理、DCDN、函数计算、MNS 或实时日志。

真实 OSS/CDN 冒烟的完整检查表见[阿里云配置第 10 节](08-aliyun-cdn-oss.md#10-小流量验收)。基础照片闭环稳定前不要启用人脸功能。

## 7. 日常更新到最新提交

### 7.1 更新前

选择低风险时段并确认：

- `git -C /opt/photostream status --short` 无输出；
- 最近一次加密数据库备份成功且可追溯；
- 当前 `status`、ready、磁盘、内存正常；
- 目标提交已经通过评审和仓库检查；
- 数据库迁移遵守“扩展后收缩”，旧、新 API 能短暂共享升级后的数据库；
- 有上一槽和外部 DNS/CDN 配置回滚记录。

部署脚本本身不创建数据库备份。没有完成[运维手册](13-operations-runbook.md)中的加密备份调度和恢复演练，不应把系统标记为正式生产就绪。

### 7.2 执行更新

```bash
sudo bash /opt/photostream/deploy/deploy.sh
```

无参数等价于：

```bash
sudo bash /opt/photostream/deploy/deploy.sh update
```

脚本执行 `git fetch` 和 `merge --ff-only`，不会 `reset --hard` 或覆盖本地改动。更新过程：

1. 旧活动槽继续处理请求；
2. 串行构建新提交镜像；
3. 在非活动槽运行向前数据库迁移；
4. 新 API/Web 健康后，Caddy 校验配置并热重载；
5. 公网 ready 冒烟失败会立即恢复旧槽；
6. 成功后等待 30 秒排空普通请求，再停止旧槽；
7. SSE 连接可能短暂重连，但客户端使用游标补发，不应丢事件。

如果已经是最新提交，脚本不会重建镜像，而会检查并自愈 PostgreSQL、Caddy 和活动应用槽，再执行公网冒烟。

### 7.3 更新后

重复第 6.1–6.4 节，另外确认：

```bash
git -C /opt/photostream rev-parse HEAD
git -C /opt/photostream rev-parse origin/main
sudo bash /opt/photostream/deploy/deploy.sh status
```

remote/分支不是 `origin/main` 时按实际配置比较。保留更新开始/结束时间、旧/新提交、活动槽、迁移结果、ready 结果和资源峰值，不记录秘密。

## 8. 回滚

### 8.1 可回滚范围

```bash
sudo bash /opt/photostream/deploy/deploy.sh rollback
```

回滚会启动另一个槽、等待内部健康、切换 Caddy、执行公网冒烟，再停止原槽。公网冒烟失败时会二次恢复原活动槽并停止失败目标。

回滚只保留一个上一槽，并且不会逆向数据库迁移。以下情况不能把应用回滚当作完整恢复：

- 新迁移删除/改名了旧代码需要的列、表或枚举；
- 数据已经由新版本不可逆转换；
- OSS/CDN/DNS/RAM 在应用外发生不兼容变更；
- 上一槽已被后续第二次更新覆盖；
- PostgreSQL 数据本身损坏。

遇到这些情况先停止扩大影响，保留数据库和日志，按评审过的灾难恢复计划处理。不要执行 `docker compose down -v`、删除 named volume、手改迁移表或清空数据库。

### 8.2 外部配置回滚

应用回滚不会自动撤销 DNS、CDN、CORS、RAM 或证书变化。外部变更必须使用部署批准记录中的精确旧值回滚，并按以下顺序降低风险：

1. 保持旧 CDN Key/域名/回源在重叠窗口可用；
2. 先恢复应用可访问的媒体 origin 和凭证；
3. 再恢复 DNS/CNAME；
4. 验证旧路径、缓存和删除；
5. 最后才撤销新资源或新 Key。

## 9. 日常巡检

### 每日

- `sudo bash /opt/photostream/deploy/deploy.sh status`；
- 主站 live/ready 和 HTTPS 证书；
- 容器重启次数、错误日志、磁盘、内存、swap；
- PostgreSQL 加密备份结果、文件大小、SHA-256 和异地/备份 Bucket 上传结果；
- 上传清理、删除任务和异常积压；
- OSS/CDN 403、5xx、回源和费用异常。

### 每周

- 检查 Git 安全更新和待发布提交，不自动追随未知分支；
- `docker system df`，评估旧镜像占用，但不要在更新/回滚窗口盲目 prune；
- 检查 Caddy 证书、系统更新和 NTP；
- 对比 OSS/CDN 用量与批准预算；
- 检查主机快照和备份保留：14 个日备份、8 个周备份。

### 每次活动前后

- 活动前验证上传者/审核员账号、相册默认口令和下载关闭状态；
- 活动中观察 API ready、SSE 重连、上传失败和主机资源；
- 活动后确认相册状态、删除/投诉流程、账单和备份；
- 不把真实学生媒体、号码、签名 URL 或 Cookie 复制到运维证据。

## 10. 常见故障排查

| 现象/错误 | 检查 | 处理 |
| --- | --- | --- |
| “仅支持 Debian 13” | `cat /etc/os-release` | 使用 Debian 13 目标机；不要注释预检绕过 |
| CPU/内存/磁盘不足 | `nproc`、`free -h`、`df -h` | 扩容或释放已批准空间；2 GiB 主机启用 swap |
| Docker 冲突包 | 脚本列出的包、`dpkg -l` | 确认不会影响其他业务后允许脚本替换；共享主机需先评审 |
| 80/443 被占用 | `sudo ss -lntup` | 停止或迁移未经计划的反向代理；不要改成暴露 3000/3001 |
| `/opt/photostream` 非空且不是仓库 | `sudo find /opt/photostream -mindepth 1 -maxdepth 2 -ls` | 确认内容归属后迁移到其他受控目录；脚本不会覆盖或自动删除 |
| 工作树不干净 | `git -C /opt/photostream status --short` | 查明文件来源并提交/迁移到仓库外；不要 `reset --hard` |
| Git 非快进 | `git -C /opt/photostream log --oneline --decorate --graph --all -20` | 人工解决分支历史；脚本不会强推或重置 |
| 构建 OOM/很慢 | `free -h`、`swapon --show`、`docker stats` | 确认 2 GiB swap、磁盘与出站；不要并行运行第二次构建 |
| PostgreSQL unhealthy | Compose logs、磁盘、volume | 保留 volume，检查磁盘/权限；不要删除数据库卷 |
| API unhealthy | API logs、ready、PostgreSQL | 常见原因是配置校验、数据库不可达、号码密钥覆盖或迁移失败；不要打印 env 全量 |
| Web unhealthy | Web logs、内存 | 检查镜像构建、只读文件系统错误和 API 内部路由 |
| Caddy/ACME 失败 | Caddy logs、A/AAAA、80/443、系统时间 | 修复 DNS/安全组/错误 AAAA；然后重新 `update` |
| HTTPS 本机成功、外网失败 | 外部网络 curl、云安全组 | 检查 NAT、安全组、防火墙和运营商网络 |
| OSS PUT CORS 失败 | 浏览器网络面板、OSS CORS | Origin 必须精确，允许实际签名头；不要改成 `*` |
| OSS 403/SignatureDoesNotMatch | API 时间、Bucket/region、RAM 权限 | 核对杭州 endpoint、系统时间、签名头和最小权限 |
| CDN 403 | Type A Key/有效期、签名 URL 时间 | 控制台有效期必须与脚本输入一致；核对主/备 Key |
| CDN 能访问但不缓存 | `Age`、Cache Key、回源日志 | 鉴权后剥离 `auth_key`，对象不可覆盖；不要关闭鉴权测试缓存 |
| 更新目标槽失败 | `status` 和目标槽日志 | 旧活动槽仍服务；修复后重跑 `update` |
| 回滚提示没有上一槽 | `status` | 首次部署或上一槽已覆盖；改走评审后的恢复流程 |
| 管理员未创建 | 更新输出、API/数据库日志 | 修复后重跑 `update`，脚本会补做初始化 |

查看特定服务最近日志的通用格式：

```bash
sudo docker compose \
  --env-file /etc/photostream/compose.env \
  -f /opt/photostream/compose.production.yml \
  --profile blue --profile green logs --since 30m --tail 300 <service>
```

不要使用 `docker inspect` 导出完整容器环境到工单，因为其中可能包含秘密。

## 11. 备份、恢复与主机迁移

部署脚本只负责应用和数据库容器，不自动创建备份 Bucket、不上传备份、不安装定时任务。正式试运行前必须按[运维、备份与事件响应手册](13-operations-runbook.md)完成：

1. 在离线受控位置生成至少 3072 位 RSA 私钥/公钥；生产主机只持有公钥；
2. 每日生成流式 AES-256-GCM + RSA-OAEP-SHA256 加密逻辑备份；
3. 只把 `.pstrbk` 密文上传到独立私有备份 Bucket，不绑定 CDN；
4. 保留 14 个日备份和 8 个周备份；
5. 至少完成一次不连接生产 OSS/CDN 的隔离恢复演练；
6. 备份 `/etc/photostream/`、部署状态和必要的云配置责任记录；Caddy 证书卷可备份，但不能泄露私钥。

新主机恢复时不要只复制 Docker 镜像：必须恢复数据库、应用秘密、Git 版本和云端配置映射。没有 `/etc/photostream/settings.sh` 时，原会话、号码密文和搜索索引可能无法正确读取。

灾难恢复禁止直接把隔离恢复命令改成生产库名。先保留故障主机和卷，确定恢复点、数据差异、DNS/CDN 切换和责任人，再执行单独评审的生产恢复方案。

## 12. 安全操作禁令

- 不提交或发送 `/etc/photostream/*`、数据库转储、AccessKey、CDN Key、Cookie、相册口令或签名 URL；
- 不开放 PostgreSQL/API/Web/Caddy 管理端口到公网；
- 不使用阿里云主账号 AccessKey，不把 Bucket 改公共读；
- 不用 `git reset --hard`、强推或跳过 `--ff-only` 处理生产分支；
- 不执行 `docker compose down -v`，不删除 PostgreSQL/Caddy named volume；
- 不在生产故障排查中使用 `set -x` 或打印完整环境；
- 不直接编辑数据库迁移表、删除队列表记录或手工伪造完成状态；
- 不把媒体代理经过香港主机，不启用未批准的云端图片处理/识别服务；
- 不在未完成学校、人脸、跨境和样本门禁时启用人脸候选找图。

## 13. 上线验收记录模板

每次首次部署或重大更新保留以下非秘密记录：

```text
环境/服务器随机标识：
批准人、执行人、复核人：
开始/结束时间：
旧提交/槽：
新提交/槽：
数据库备份标识与 SHA-256：
数据库迁移结果：
容器 health 结果：
主站 live/ready/HTTPS 结果：
OSS 直传与禁止覆盖结果：
CDN 有效/篡改/过期/缓存结果：
资源峰值（内存/swap/磁盘）：
设备/网络验证范围：
账单检查时间与责任人：
回滚点：
未验证项：
最终结论：通过 / 回滚 / 暂停
```

任何未实际执行的项目必须写 **Unverified**，不能用本地单元测试、Chromium 或代码阅读替代真实 Debian 13、云端、微信/Safari、校园网络和恢复演练证据。

## 14. 命令速查

```bash
# 首次安装
sudo bash /tmp/photostream-deploy.sh install

# 更新到配置分支最新提交；无新提交时自愈
sudo bash /opt/photostream/deploy/deploy.sh
sudo bash /opt/photostream/deploy/deploy.sh update

# 重新交互配置，回车保留已有值
sudo bash /opt/photostream/deploy/deploy.sh configure

# 回到上一个应用槽；不逆向迁移数据库
sudo bash /opt/photostream/deploy/deploy.sh rollback

# 查看活动槽和容器状态
sudo bash /opt/photostream/deploy/deploy.sh status

# 显示脚本帮助
bash /opt/photostream/deploy/deploy.sh --help
```

仓库内脚本回归检查：

```bash
bash -n deploy/deploy.sh deploy/deploy.test.sh
bash deploy/deploy.test.sh
```

目标主机完成实际 Docker/Compose/Caddy、DNS/ACME、OSS/CDN、备份恢复和小流量试运行前，部署状态仍为 **Partial/Unverified**，不得直接扩大到真实活动。
