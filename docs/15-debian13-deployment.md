# Debian 13 生产部署

## 1. 范围

`deploy/deploy.sh` 面向一台至少 2 vCPU、约 2 GiB RAM、8 GiB 可用磁盘的 Debian 13 `amd64`/`arm64` 主机。它安装或复用 Docker Engine/Compose，串行构建镜像，启动 PostgreSQL 18.6、Caddy、Next.js 和 Fastify，并以蓝绿双槽执行更新。

脚本不会创建或修改 DNS、阿里云 OSS/CDN/RAM、IMM、EventBridge、安全组或学校数据。首次执行前必须按[阿里云配置](08-aliyun-cdn-oss.md)完成基础照片数据面，至少具备：

- 已指向服务器公网地址的主站 A/AAAA 记录，公网 80/TCP、443/TCP 和 443/UDP 可达；
- 已备案并完成 CNAME 的媒体 CDN HTTPS Origin，启用 Type A 鉴权且有效期与脚本输入一致；
- 杭州地域、标准存储、私有 ACL 的媒体 Bucket，以及只具备文档所列最小权限的应用 RAM AccessKey；
- CDN 私有回源、OSS CORS、缓存规则和允许的 `media/` 前缀已按文档配置；
- 若选择启用人脸候选找图，学校/跨境/样本门禁和独立 RAM、IMM Project、参考照 Bucket、EventBridge 必须已经完成。默认选择为关闭。

## 2. 首次运行

服务器上的仓库必须处于待部署分支且没有任何已跟踪或未跟踪改动。执行：

```bash
git clone <仓库地址> /opt/photostream
cd /opt/photostream
sudo bash deploy/deploy.sh install
```

脚本会交互询问主站/CDN、OSS/RAM、CDN 鉴权、可选人脸资源、首位管理员、更新 remote/分支和 swap 选择。数据库口令、会话/CSRF/游标/访客/相册/用户/分析密钥、号码密钥及 EventBridge token 自动使用 CSPRNG 生成。

输入值和生成值保存在 `/etc/photostream/settings.sh`，生成的四类运行环境文件也位于 `/etc/photostream/`；目录和文件为 `root:root`，秘密文件权限为 `0600`。API、Web、Caddy 和 Compose 使用不同环境文件，Web/Caddy 容器不会得到数据库或 RAM 密钥。部署状态及 Caddy 活动路由保存在 `/var/lib/photostream/`。这些文件都不在 Git 仓库内，必须纳入主机秘密备份；它们不是静态加密文件，主机 root 仍可读取。

部署成功后脚本只显示一次首位管理员的临时密码。应立即登录并修改。若首次管理员步骤临时失败，直接再次执行脚本即可补做，不会重新询问配置。

## 3. 更新、重配置和回滚

以后直接运行即可拉取配置分支的最新提交；没有新提交时不会重建：

```bash
cd /opt/photostream
sudo bash deploy/deploy.sh
# 等价于
sudo bash deploy/deploy.sh update
```

更新顺序固定为：

1. `git fetch` 后对配置分支执行 `--ff-only` 合并；工作树不干净或发生非快进时停止；
2. 串行构建按提交标记的 API/Web 镜像，活动槽继续服务；
3. PostgreSQL 保持运行，目标 API 镜像先执行 Drizzle 迁移；
4. 启动非活动槽并等待 API ready 与 Web 健康检查；
5. 原子替换 Caddy 路由、校验并热重载，再执行公网 HTTPS ready 冒烟；
6. 冒烟失败立即切回旧槽；成功后等待普通请求排空，再停止旧槽。SSE 会按既有游标重连，不丢事件。

数据库迁移必须继续遵守“扩展后收缩”的向前兼容约束：切流时旧、新 API 会短暂共享同一数据库。`rollback` 只切换应用槽，不逆向数据库迁移。

其他命令：

```bash
sudo bash deploy/deploy.sh status
sudo bash deploy/deploy.sh configure  # 回车保留已有值，随后蓝绿发布配置
sudo bash deploy/deploy.sh rollback   # 回到上一个仍保留的槽
```

每个槽限制为 API 320 MiB、Web 320 MiB，PostgreSQL 512 MiB，Caddy 96 MiB。脚本可在没有 swap 时创建精确的 2 GiB `/swapfile`；构建串行执行，蓝绿并存只发生在健康检查和排空窗口。

## 4. 验证与边界

仓库内可在 Linux/Git Bash 执行纯脚本测试：

```bash
bash -n deploy/deploy.sh deploy/deploy.test.sh
bash deploy/deploy.test.sh
```

本地没有 Docker 时，镜像实际构建、Compose/Caddy 配置解析、Debian apt 安装、真实 2C2G 峰值、DNS/ACME、OSS V4、CDN 刷新和公网切流仍必须在获准的目标环境验证，不能由单元测试升级为 **Confirmed**。生产数据库加密备份与隔离恢复继续按[运维手册](13-operations-runbook.md)单独配置和演练；部署脚本不会把数据库明文或备份发送到媒体 Bucket。
