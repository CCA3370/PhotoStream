# 数据库备份功能移除验证

日期：2026-09-10

用户明确决定 PhotoStream 不需要应用管理的数据库备份。当前变更删除手动备份/恢复、自动备份周期、加密 envelope、14+8 保留、北京 OSS 备份上传、systemd 定时器、相关 CI guard、npm/env 入口和现行部署要求。

P1 的运行时可观测性和后台任务防重入与备份无关，继续保留。

本变更只修改仓库，不删除仓库外文件、服务器 systemd 单元、数据库副本、OSS Bucket 或对象，也不执行生产部署。

合并前要求现有四路 CI 全部通过：Lint/Typecheck/Unit/Build、PostgreSQL/API integration、Deployment contract、Chromium smoke。
