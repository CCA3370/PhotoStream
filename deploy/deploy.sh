#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly COMPOSE_FILE="$PROJECT_DIR/compose.production.yml"
readonly SETTINGS_DIR="${PHOTOSTREAM_SETTINGS_DIR:-/etc/photostream}"
readonly SETTINGS_FILE="$SETTINGS_DIR/settings.sh"
readonly COMPOSE_ENV_FILE="$SETTINGS_DIR/compose.env"
readonly API_ENV_FILE="$SETTINGS_DIR/api.env"
readonly WEB_ENV_FILE="$SETTINGS_DIR/web.env"
readonly CADDY_ENV_FILE="$SETTINGS_DIR/caddy.env"
readonly STATE_DIR="${PHOTOSTREAM_STATE_DIR:-/var/lib/photostream}"
readonly STATE_FILE="$STATE_DIR/deploy-state.sh"
readonly CADDY_STATE_DIR="$STATE_DIR/caddy"
readonly LOCK_FILE="${PHOTOSTREAM_LOCK_FILE:-/run/lock/photostream-deploy.lock}"

APP_HOST=""
ACME_EMAIL=""
MEDIA_BASE_URL=""
ALIYUN_OSS_MEDIA_BUCKET=""
ALIYUN_OSS_ENDPOINT="https://oss-cn-hangzhou.aliyuncs.com"
ALIYUN_ACCESS_KEY_ID=""
ALIYUN_ACCESS_KEY_SECRET=""
ALIYUN_CDN_AUTH_KEY_CURRENT=""
ALIYUN_CDN_AUTH_KEY_PREVIOUS=""
ALIYUN_CDN_AUTH_VALIDITY_SECONDS="7200"
FACE_SEARCH_GLOBAL_ENABLED="false"
ALIYUN_FACE_ACCESS_KEY_ID=""
ALIYUN_FACE_ACCESS_KEY_SECRET=""
ALIYUN_ACCOUNT_ID=""
ALIYUN_IMM_PROJECT_NAME=""
ALIYUN_OSS_FACE_REFERENCE_BUCKET=""
FACE_SEARCH_THRESHOLD_VERSION="unqualified"
ADMIN_USERNAME="admin"
ADMIN_DISPLAY_NAME="系统管理员"
GIT_REMOTE="origin"
GIT_BRANCH="main"
CREATE_SWAP="true"
POSTGRES_PASSWORD=""
SESSION_SECRET_CURRENT=""
CSRF_SECRET=""
CURSOR_SIGNING_SECRET=""
VISITOR_SESSION_SECRET=""
ALBUM_PASSWORD_GENERATION_SECRET=""
USER_PASSWORD_GENERATION_SECRET=""
ANALYTICS_HMAC_SECRET=""
BIB_DATA_KEY=""
BIB_SEARCH_KEY=""
EVENTBRIDGE_SIGNATURE_TOKEN=""

ACTIVE_SLOT=""
BLUE_REVISION=""
GREEN_REVISION=""
BLUE_API_IMAGE="photostream-api:pending"
BLUE_WEB_IMAGE="photostream-web:pending"
GREEN_API_IMAGE="photostream-api:pending"
GREEN_WEB_IMAGE="photostream-web:pending"
ADMIN_BOOTSTRAPPED="false"

log() { printf '[PhotoStream] %s\n' "$*"; }
warn() { printf '[PhotoStream] 警告：%s\n' "$*" >&2; }
die() { printf '[PhotoStream] 错误：%s\n' "$*" >&2; exit 1; }

on_error() {
  local exit_code=$?
  printf '[PhotoStream] 部署在第 %s 行失败（退出码 %s）。旧服务和已构建镜像均保留。\n' "${BASH_LINENO[0]:-unknown}" "$exit_code" >&2
  exit "$exit_code"
}
trap on_error ERR

usage() {
  cat <<'EOF'
用法：sudo bash deploy/deploy.sh [命令]

  install      首次交互配置并部署；配置会保存，下次不再询问
  update       拉取配置分支最新提交并执行蓝绿无停机更新
  configure    重新交互修改已保存配置，并部署新配置
  rollback     切回上一部署槽（数据库迁移不会逆向回滚）
  status       显示当前版本与容器状态
  help         显示帮助

不带命令时：未安装则执行 install；已安装则直接执行 update。
EOF
}

require_root() {
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "请使用 sudo 运行此脚本。"
}

acquire_lock() {
  mkdir -p -- "$(dirname -- "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "另一项 PhotoStream 部署操作正在运行。"
}

assert_secure_file() {
  local file=$1
  [[ -f "$file" ]] || die "配置文件不存在：$file"
  [[ $(stat -c '%u' -- "$file") == 0 ]] || die "配置文件必须归 root 所有：$file"
  [[ -z $(find "$file" -perm /077 -print -quit) ]] || die "配置文件权限过宽：$file"
}

load_settings() {
  assert_secure_file "$SETTINGS_FILE"
  # shellcheck source=/dev/null
  source "$SETTINGS_FILE"
}

load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    assert_secure_file "$STATE_FILE"
    # shellcheck source=/dev/null
    source "$STATE_FILE"
  fi
}

save_assignment() {
  local name=$1
  printf '%s=%q\n' "$name" "${!name-}"
}

save_settings() {
  local temp
  mkdir -p -- "$SETTINGS_DIR"
  temp=$(mktemp "$SETTINGS_DIR/settings.XXXXXX")
  {
    printf 'SETTINGS_VERSION=1\n'
    local name
    for name in \
      APP_HOST ACME_EMAIL MEDIA_BASE_URL ALIYUN_OSS_MEDIA_BUCKET ALIYUN_OSS_ENDPOINT \
      ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_CDN_AUTH_KEY_CURRENT \
      ALIYUN_CDN_AUTH_KEY_PREVIOUS ALIYUN_CDN_AUTH_VALIDITY_SECONDS \
      FACE_SEARCH_GLOBAL_ENABLED ALIYUN_FACE_ACCESS_KEY_ID ALIYUN_FACE_ACCESS_KEY_SECRET \
      ALIYUN_ACCOUNT_ID ALIYUN_IMM_PROJECT_NAME ALIYUN_OSS_FACE_REFERENCE_BUCKET \
      FACE_SEARCH_THRESHOLD_VERSION ADMIN_USERNAME ADMIN_DISPLAY_NAME GIT_REMOTE GIT_BRANCH \
      CREATE_SWAP POSTGRES_PASSWORD SESSION_SECRET_CURRENT CSRF_SECRET CURSOR_SIGNING_SECRET \
      VISITOR_SESSION_SECRET ALBUM_PASSWORD_GENERATION_SECRET USER_PASSWORD_GENERATION_SECRET \
      ANALYTICS_HMAC_SECRET BIB_DATA_KEY BIB_SEARCH_KEY EVENTBRIDGE_SIGNATURE_TOKEN; do
      save_assignment "$name"
    done
  } >"$temp"
  chmod 600 "$temp"
  chown root:root "$temp"
  mv -f -- "$temp" "$SETTINGS_FILE"
}

save_state() {
  local temp
  mkdir -p -- "$STATE_DIR"
  temp=$(mktemp "$STATE_DIR/deploy-state.XXXXXX")
  {
    printf 'STATE_VERSION=1\n'
    local name
    for name in ACTIVE_SLOT BLUE_REVISION GREEN_REVISION BLUE_API_IMAGE BLUE_WEB_IMAGE \
      GREEN_API_IMAGE GREEN_WEB_IMAGE ADMIN_BOOTSTRAPPED; do
      save_assignment "$name"
    done
  } >"$temp"
  chmod 600 "$temp"
  chown root:root "$temp"
  mv -f -- "$temp" "$STATE_FILE"
}

random_hex() { openssl rand -hex "${1:-32}"; }
random_base64url() { openssl rand -base64 "${1:-32}" | tr '+/' '-_' | tr -d '=\n'; }

ensure_generated_secrets() {
  [[ -n "$POSTGRES_PASSWORD" ]] || POSTGRES_PASSWORD=$(random_hex 24)
  [[ -n "$SESSION_SECRET_CURRENT" ]] || SESSION_SECRET_CURRENT=$(random_hex 32)
  [[ -n "$CSRF_SECRET" ]] || CSRF_SECRET=$(random_hex 32)
  [[ -n "$CURSOR_SIGNING_SECRET" ]] || CURSOR_SIGNING_SECRET=$(random_hex 32)
  [[ -n "$VISITOR_SESSION_SECRET" ]] || VISITOR_SESSION_SECRET=$(random_hex 32)
  [[ -n "$ALBUM_PASSWORD_GENERATION_SECRET" ]] || ALBUM_PASSWORD_GENERATION_SECRET=$(random_hex 32)
  [[ -n "$USER_PASSWORD_GENERATION_SECRET" ]] || USER_PASSWORD_GENERATION_SECRET=$(random_hex 32)
  [[ -n "$ANALYTICS_HMAC_SECRET" ]] || ANALYTICS_HMAC_SECRET=$(random_hex 32)
  [[ -n "$BIB_DATA_KEY" ]] || BIB_DATA_KEY=$(random_base64url 32)
  [[ -n "$BIB_SEARCH_KEY" ]] || BIB_SEARCH_KEY=$(random_hex 32)
  [[ -n "$EVENTBRIDGE_SIGNATURE_TOKEN" ]] || EVENTBRIDGE_SIGNATURE_TOKEN=$(random_hex 32)
}

ask_value() {
  local name=$1 label=$2 pattern=$3 secret=${4:-false}
  local current=${!name-} value prompt_suffix
  while true; do
    if [[ -n "$current" ]]; then
      [[ "$secret" == true ]] && prompt_suffix='（回车保留现有值）' || prompt_suffix="（默认：$current）"
    else
      prompt_suffix=''
    fi
    if [[ "$secret" == true ]]; then
      read -r -s -p "$label$prompt_suffix：" value
      printf '\n'
    else
      read -r -p "$label$prompt_suffix：" value
    fi
    [[ -n "$value" ]] || value=$current
    if [[ -n "$value" && "$value" =~ $pattern ]]; then
      printf -v "$name" '%s' "$value"
      return
    fi
    warn "输入格式无效，请重新输入。"
  done
}

ask_optional_secret() {
  local name=$1 label=$2 pattern=$3
  local current=${!name-} value
  if [[ -n "$current" ]]; then
    read -r -s -p "$label（回车保留，输入 - 清空）：" value
  else
    read -r -s -p "$label（可选，回车跳过）：" value
  fi
  printf '\n'
  [[ -n "$value" ]] || value=$current
  [[ "$value" != '-' ]] || value=''
  [[ -z "$value" || "$value" =~ $pattern ]] || die "$label格式无效。"
  printf -v "$name" '%s' "$value"
}

ask_yes_no() {
  local name=$1 label=$2 current=${!1:-false} answer hint
  [[ "$current" == true ]] && hint='Y/n' || hint='y/N'
  while true; do
    read -r -p "$label [$hint]：" answer
    if [[ -z "$answer" ]]; then
      printf -v "$name" '%s' "$current"
      return
    fi
    case "${answer,,}" in
      y|yes) printf -v "$name" true; return ;;
      n|no) printf -v "$name" false; return ;;
      *) warn "请输入 y 或 n。" ;;
    esac
  done
}

configure_settings() {
  local host_pattern='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
  local email_pattern='^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$'
  local url_pattern='^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(:[0-9]{1,5})?$'
  local bucket_pattern='^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
  local credential_pattern='^[A-Za-z0-9._~+-]{8,128}$'
  local cdn_key_pattern='^[A-Za-z0-9._~+-]{16,128}$'

  log "配置只写入 $SETTINGS_FILE（root:root 0600），不会写回仓库。"
  ask_value APP_HOST "主站域名（仅域名，不含 https://）" "$host_pattern"
  ask_value ACME_EMAIL "ACME 证书通知邮箱" "$email_pattern"
  [[ -n "$MEDIA_BASE_URL" ]] || MEDIA_BASE_URL="https://cdn.$APP_HOST"
  ask_value MEDIA_BASE_URL "媒体 CDN HTTPS Origin（不含路径）" "$url_pattern"
  ask_value ALIYUN_OSS_MEDIA_BUCKET "杭州私有媒体 OSS Bucket" "$bucket_pattern"
  ask_value ALIYUN_ACCESS_KEY_ID "应用 RAM AccessKey ID" "$credential_pattern" true
  ask_value ALIYUN_ACCESS_KEY_SECRET "应用 RAM AccessKey Secret" "$credential_pattern" true
  ask_value ALIYUN_CDN_AUTH_KEY_CURRENT "CDN Type A 当前鉴权 Key" "$cdn_key_pattern" true
  ask_optional_secret ALIYUN_CDN_AUTH_KEY_PREVIOUS "CDN Type A 备用鉴权 Key" "$cdn_key_pattern"
  ask_value ALIYUN_CDN_AUTH_VALIDITY_SECONDS "CDN 控制台鉴权有效期（秒）" '^[0-9]{2,5}$'
  (( ALIYUN_CDN_AUTH_VALIDITY_SECONDS >= 60 && ALIYUN_CDN_AUTH_VALIDITY_SECONDS <= 86400 )) || \
    die "CDN 鉴权有效期必须为 60–86400 秒。"

  ask_yes_no FACE_SEARCH_GLOBAL_ENABLED "是否配置并全局启用人脸候选找图（需已完成学校门禁与独立云资源）"
  if [[ "$FACE_SEARCH_GLOBAL_ENABLED" == true ]]; then
    ask_value ALIYUN_FACE_ACCESS_KEY_ID "人脸专用 RAM AccessKey ID" "$credential_pattern" true
    ask_value ALIYUN_FACE_ACCESS_KEY_SECRET "人脸专用 RAM AccessKey Secret" "$credential_pattern" true
    ask_value ALIYUN_ACCOUNT_ID "阿里云账号 UID" '^[0-9]{6,32}$'
    ask_value ALIYUN_IMM_PROJECT_NAME "杭州 IMM Project 名" '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'
    ask_value ALIYUN_OSS_FACE_REFERENCE_BUCKET "杭州私有人脸参考照 Bucket" "$bucket_pattern"
    ask_value FACE_SEARCH_THRESHOLD_VERSION "已验证的人脸阈值版本" '^[A-Za-z0-9._-]{1,80}$'
    [[ "$FACE_SEARCH_THRESHOLD_VERSION" != unqualified ]] || die "启用人脸找图时不能使用 unqualified 阈值。"
    [[ "$ALIYUN_OSS_FACE_REFERENCE_BUCKET" != "$ALIYUN_OSS_MEDIA_BUCKET" ]] || \
      die "人脸参考照必须使用独立 Bucket。"
  fi

  ask_value ADMIN_USERNAME "首位管理员用户名" '^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$'
  ask_value ADMIN_DISPLAY_NAME "首位管理员展示名" '^.{1,80}$'
  ask_value GIT_REMOTE "更新使用的 Git remote" '^[A-Za-z0-9._-]{1,64}$'
  ask_value GIT_BRANCH "更新使用的分支" '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
  ask_yes_no CREATE_SWAP "没有 swap 时是否创建 2GiB /swapfile（2GiB 主机建议启用）"

  ensure_generated_secrets
  save_settings
  log "配置已按 root-only 权限保存；后续 update 不会再次询问这些值。"
}

write_env() {
  local name=$1 value=$2
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "环境变量 $name 含换行。"
  printf '%s=%s\n' "$name" "$value"
}

install_env_file() {
  local temp=$1 target=$2
  chmod 600 "$temp"
  chown root:root "$temp"
  mv -f -- "$temp" "$target"
}

render_runtime_envs() {
  local temp photo_upload_origin face_upload_origin
  photo_upload_origin="https://${ALIYUN_OSS_MEDIA_BUCKET}.oss-cn-hangzhou.aliyuncs.com"
  face_upload_origin=$photo_upload_origin
  [[ -z "$ALIYUN_OSS_FACE_REFERENCE_BUCKET" ]] || \
    face_upload_origin="https://${ALIYUN_OSS_FACE_REFERENCE_BUCKET}.oss-cn-hangzhou.aliyuncs.com"
  temp=$(mktemp "$SETTINGS_DIR/api.env.XXXXXX")
  {
    write_env NODE_ENV production
    write_env HOST 0.0.0.0
    write_env PORT 3001
    write_env APP_ORIGIN "https://$APP_HOST"
    write_env MEDIA_BASE_URL "$MEDIA_BASE_URL"
    write_env DATABASE_URL "postgresql://photostream:${POSTGRES_PASSWORD}@postgres:5432/photostream"
    write_env SESSION_SECRET_CURRENT "$SESSION_SECRET_CURRENT"
    write_env CSRF_SECRET "$CSRF_SECRET"
    write_env CURSOR_SIGNING_SECRET "$CURSOR_SIGNING_SECRET"
    write_env VISITOR_SESSION_SECRET "$VISITOR_SESSION_SECRET"
    write_env ALBUM_PASSWORD_GENERATION_SECRET "$ALBUM_PASSWORD_GENERATION_SECRET"
    write_env USER_PASSWORD_GENERATION_SECRET "$USER_PASSWORD_GENERATION_SECRET"
    write_env ANALYTICS_HMAC_SECRET "$ANALYTICS_HMAC_SECRET"
    write_env BIB_DATA_KEY "$BIB_DATA_KEY"
    write_env BIB_SEARCH_KEY "$BIB_SEARCH_KEY"
    write_env BIB_KEY_VERSION v1
    write_env BIB_OCR_AUTOMATION_STATUS experimental
    write_env OBJECT_STORAGE_DRIVER aliyun
    write_env ALIYUN_OSS_REGION oss-cn-hangzhou
    write_env ALIYUN_OSS_ENDPOINT "$ALIYUN_OSS_ENDPOINT"
    write_env ALIYUN_OSS_MEDIA_BUCKET "$ALIYUN_OSS_MEDIA_BUCKET"
    write_env ALIYUN_ACCESS_KEY_ID "$ALIYUN_ACCESS_KEY_ID"
    write_env ALIYUN_ACCESS_KEY_SECRET "$ALIYUN_ACCESS_KEY_SECRET"
    write_env ALIYUN_CDN_AUTH_KEY_CURRENT "$ALIYUN_CDN_AUTH_KEY_CURRENT"
    write_env ALIYUN_CDN_AUTH_KEY_PREVIOUS "$ALIYUN_CDN_AUTH_KEY_PREVIOUS"
    write_env ALIYUN_CDN_AUTH_VALIDITY_SECONDS "$ALIYUN_CDN_AUTH_VALIDITY_SECONDS"
    write_env FACE_SEARCH_GLOBAL_ENABLED "$FACE_SEARCH_GLOBAL_ENABLED"
    write_env FACE_SEARCH_THRESHOLD_VERSION "$FACE_SEARCH_THRESHOLD_VERSION"
    write_env ALIYUN_FACE_ACCESS_KEY_ID "$ALIYUN_FACE_ACCESS_KEY_ID"
    write_env ALIYUN_FACE_ACCESS_KEY_SECRET "$ALIYUN_FACE_ACCESS_KEY_SECRET"
    write_env ALIYUN_ACCOUNT_ID "$ALIYUN_ACCOUNT_ID"
    write_env ALIYUN_IMM_REGION cn-hangzhou
    write_env ALIYUN_IMM_PROJECT_NAME "$ALIYUN_IMM_PROJECT_NAME"
    write_env ALIYUN_OSS_FACE_REFERENCE_BUCKET "$ALIYUN_OSS_FACE_REFERENCE_BUCKET"
    write_env EVENTBRIDGE_SIGNATURE_TOKEN "$EVENTBRIDGE_SIGNATURE_TOKEN"
    write_env LOG_LEVEL info
  } >"$temp"
  install_env_file "$temp" "$API_ENV_FILE"

  temp=$(mktemp "$SETTINGS_DIR/web.env.XXXXXX")
  {
    write_env NODE_ENV production
    write_env HOSTNAME 0.0.0.0
    write_env PORT 3000
    write_env API_INTERNAL_URL http://caddy:8080
    write_env MEDIA_BASE_URL "$MEDIA_BASE_URL"
    write_env PHOTO_UPLOAD_BASE_URL "$photo_upload_origin"
    write_env FACE_REFERENCE_UPLOAD_BASE_URL "$face_upload_origin"
  } >"$temp"
  install_env_file "$temp" "$WEB_ENV_FILE"

  temp=$(mktemp "$SETTINGS_DIR/caddy.env.XXXXXX")
  {
    write_env APP_HOST "$APP_HOST"
    write_env ACME_EMAIL "$ACME_EMAIL"
  } >"$temp"
  install_env_file "$temp" "$CADDY_ENV_FILE"

  temp=$(mktemp "$SETTINGS_DIR/compose.env.XXXXXX")
  {
    write_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
    write_env PHOTOSTREAM_API_ENV "$API_ENV_FILE"
    write_env PHOTOSTREAM_WEB_ENV "$WEB_ENV_FILE"
    write_env PHOTOSTREAM_CADDY_ENV "$CADDY_ENV_FILE"
    write_env PHOTOSTREAM_CADDY_STATE "$CADDY_STATE_DIR"
    write_env BLUE_API_IMAGE "$BLUE_API_IMAGE"
    write_env BLUE_WEB_IMAGE "$BLUE_WEB_IMAGE"
    write_env GREEN_API_IMAGE "$GREEN_API_IMAGE"
    write_env GREEN_WEB_IMAGE "$GREEN_WEB_IMAGE"
  } >"$temp"
  install_env_file "$temp" "$COMPOSE_ENV_FILE"
}

check_host() {
  [[ -r /etc/os-release ]] || die "无法识别操作系统。"
  # shellcheck source=/etc/os-release
  source /etc/os-release
  [[ "${ID:-}" == debian && "${VERSION_ID:-}" == 13 ]] || \
    die "此脚本仅支持 Debian 13；当前为 ${PRETTY_NAME:-unknown}。"
  case "$(dpkg --print-architecture)" in amd64|arm64) ;; *) die "仅支持 amd64/arm64。" ;; esac
  (( $(nproc) >= 2 )) || die "至少需要 2 个 CPU 核心。"
  local memory_kib free_kib
  memory_kib=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  (( memory_kib >= 1800000 )) || die "内存不足：至少需要约 2GiB。"
  free_kib=$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {print $4}')
  (( free_kib >= 8 * 1024 * 1024 )) || die "项目磁盘至少需要 8GiB 可用空间。"
  [[ -f "$COMPOSE_FILE" && -f "$PROJECT_DIR/Dockerfile" ]] || die "部署文件不完整。"
}

install_docker() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl git openssl util-linux
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    log "安装 Docker 官方 Debian 13 软件源与 Compose 插件。"
    local conflicting_packages=() package
    for package in docker.io docker-compose docker-doc podman-docker containerd runc; do
      if dpkg-query -W -f='${db:Status-Abbrev}' "$package" 2>/dev/null | grep -q '^ii '; then
        conflicting_packages+=("$package")
      fi
    done
    if (( ${#conflicting_packages[@]} > 0 )); then
      warn "将移除与 Docker 官方包冲突的软件包：${conflicting_packages[*]}"
      local confirm=false
      ask_yes_no confirm "是否继续替换为 Docker 官方软件包"
      [[ "$confirm" == true ]] || die "用户取消 Docker 软件包替换。"
      apt-get remove -y "${conflicting_packages[@]}"
    fi
    install -m 0755 -d /etc/apt/keyrings
    local key_temp
    key_temp=$(mktemp /etc/apt/keyrings/docker.asc.XXXXXX)
    curl -fsSL https://download.docker.com/linux/debian/gpg -o "$key_temp"
    chmod a+r "$key_temp"
    mv -f -- "$key_temp" /etc/apt/keyrings/docker.asc
    printf '%s\n' \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable" \
      >/etc/apt/sources.list.d/docker.sources.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
  docker info >/dev/null
}

ensure_swap() {
  [[ "$CREATE_SWAP" == true ]] || return
  [[ -z $(swapon --noheadings --show=NAME) ]] || return
  if [[ -e /swapfile ]]; then
    die "/swapfile 已存在但未启用；为避免覆盖，请先人工核查。"
  fi
  log "创建 2GiB swap 作为构建与蓝绿切换的 OOM 兜底。"
  if ! fallocate -l 2G /swapfile; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
  fi
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -qF '/swapfile none swap sw 0 0' /etc/fstab || \
    printf '%s\n' '/swapfile none swap sw 0 0' >>/etc/fstab
}

compose() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

sync_latest_commit() {
  [[ -d "$PROJECT_DIR/.git" ]] || die "项目目录不是 Git 仓库：$PROJECT_DIR"
  [[ -z $(git -C "$PROJECT_DIR" status --porcelain) ]] || \
    die "服务器工作树有未提交改动，拒绝覆盖。"
  local current_branch
  current_branch=$(git -C "$PROJECT_DIR" branch --show-current)
  [[ "$current_branch" == "$GIT_BRANCH" ]] || \
    die "当前分支为 $current_branch，配置要求 $GIT_BRANCH。"
  log "获取 $GIT_REMOTE/$GIT_BRANCH 的最新提交。"
  git -C "$PROJECT_DIR" fetch --prune "$GIT_REMOTE" "$GIT_BRANCH"
  git -C "$PROJECT_DIR" merge --ff-only "$GIT_REMOTE/$GIT_BRANCH"
}

build_images() {
  local revision=$1
  log "串行构建 API 镜像 $revision。"
  DOCKER_BUILDKIT=1 docker build --target api --tag "photostream-api:$revision" "$PROJECT_DIR"
  log "串行构建 Web 镜像 $revision。"
  DOCKER_BUILDKIT=1 docker build \
    --target web \
    --build-arg API_INTERNAL_URL=http://caddy:8080 \
    --build-arg "MEDIA_BASE_URL=$MEDIA_BASE_URL" \
    --tag "photostream-web:$revision" \
    "$PROJECT_DIR"
}

set_slot_release() {
  local slot=$1 revision=$2
  if [[ "$slot" == blue ]]; then
    BLUE_REVISION=$revision
    BLUE_API_IMAGE="photostream-api:$revision"
    BLUE_WEB_IMAGE="photostream-web:$revision"
    [[ "$GREEN_API_IMAGE" != photostream-api:pending ]] || GREEN_API_IMAGE=$BLUE_API_IMAGE
    [[ "$GREEN_WEB_IMAGE" != photostream-web:pending ]] || GREEN_WEB_IMAGE=$BLUE_WEB_IMAGE
  else
    GREEN_REVISION=$revision
    GREEN_API_IMAGE="photostream-api:$revision"
    GREEN_WEB_IMAGE="photostream-web:$revision"
    [[ "$BLUE_API_IMAGE" != photostream-api:pending ]] || BLUE_API_IMAGE=$GREEN_API_IMAGE
    [[ "$BLUE_WEB_IMAGE" != photostream-web:pending ]] || BLUE_WEB_IMAGE=$GREEN_WEB_IMAGE
  fi
}

write_routes() {
  local slot=$1 public_temp api_temp
  [[ "$slot" == blue || "$slot" == green ]] || die "无效部署槽：$slot"
  mkdir -p -- "$CADDY_STATE_DIR"
  chmod 755 "$CADDY_STATE_DIR"
  public_temp=$(mktemp "$CADDY_STATE_DIR/public.XXXXXX")
  api_temp=$(mktemp "$CADDY_STATE_DIR/api.XXXXXX")
  printf 'handle /api/* {\n\treverse_proxy api-%s:3001\n}\nhandle {\n\treverse_proxy web-%s:3000\n}\n' \
    "$slot" "$slot" >"$public_temp"
  printf 'reverse_proxy api-%s:3001\n' "$slot" >"$api_temp"
  chmod 644 "$public_temp" "$api_temp"
  mv -f -- "$public_temp" "$CADDY_STATE_DIR/active-public.caddy"
  mv -f -- "$api_temp" "$CADDY_STATE_DIR/active-api.caddy"
}

container_id() {
  compose --profile blue --profile green ps -q "$1"
}

wait_healthy() {
  local service=$1 timeout=${2:-180} id status deadline
  id=$(container_id "$service")
  [[ -n "$id" ]] || die "容器未创建：$service"
  deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
    case "$status" in
      healthy|running) log "$service 已就绪。"; return ;;
      unhealthy|exited|dead) docker logs --tail 80 "$id" >&2 || true; die "$service 启动失败（$status）。" ;;
    esac
    sleep 3
  done
  docker logs --tail 80 "$id" >&2 || true
  die "等待 $service 健康检查超时。"
}

reload_caddy_for_slot() {
  local slot=$1 previous=$2
  write_routes "$slot"
  if ! compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile; then
    [[ -z "$previous" ]] || write_routes "$previous"
    die "Caddy 新路由校验失败。"
  fi
  if ! compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then
    if [[ -n "$previous" ]]; then
      write_routes "$previous"
      compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true
    fi
    die "Caddy 切流失败。"
  fi
}

public_smoke() {
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if curl --fail --silent --show-error --max-time 8 \
      "https://$APP_HOST/api/v1/health/ready" >/dev/null; then
      return
    fi
    sleep 5
  done
  return 1
}

bootstrap_admin() {
  [[ "$ADMIN_BOOTSTRAPPED" == false ]] || return
  local slot=$1 token
  token=$(random_hex 32)
  log "创建首位管理员；一次性临时密码将在下面显示一次。"
  compose --profile "$slot" run --rm --no-deps \
    -e "BOOTSTRAP_ADMIN_TOKEN=$token" \
    "api-$slot" node dist/cli/bootstrap-admin.js "$ADMIN_USERNAME" "$ADMIN_DISPLAY_NAME"
  ADMIN_BOOTSTRAPPED=true
  save_state
}

deploy_release() {
  local force=${1:-false} previous target revision base_revision full_revision
  previous=$ACTIVE_SLOT
  if [[ "$ACTIVE_SLOT" == blue ]]; then target=green; else target=blue; fi
  full_revision=$(git -C "$PROJECT_DIR" rev-parse HEAD)
  base_revision=${full_revision:0:12}
  if [[ "$force" != true && -n "$ACTIVE_SLOT" ]]; then
    local active_revision
    [[ "$ACTIVE_SLOT" == blue ]] && active_revision=$BLUE_REVISION || active_revision=$GREEN_REVISION
    if [[ "$active_revision" == "$base_revision" || "$active_revision" == "$base_revision"-* ]]; then
      log "当前已经是最新提交 $base_revision；检查并自愈活动槽。"
      write_routes "$ACTIVE_SLOT"
      compose up -d postgres caddy
      compose --profile "$ACTIVE_SLOT" up -d --no-deps "api-$ACTIVE_SLOT" "web-$ACTIVE_SLOT"
      wait_healthy postgres 180
      wait_healthy "api-$ACTIVE_SLOT" 180
      wait_healthy "web-$ACTIVE_SLOT" 180
      wait_healthy caddy 60
      compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
      public_smoke || die "活动槽公网健康检查失败。"
      bootstrap_admin "$ACTIVE_SLOT"
      return
    fi
  fi
  revision=$base_revision
  if [[ "$force" == true && -n "$ACTIVE_SLOT" ]]; then
    revision="${base_revision}-$(date -u +%Y%m%d%H%M%S)"
  fi

  build_images "$revision"
  set_slot_release "$target" "$revision"
  save_state
  render_runtime_envs

  if [[ -z "$previous" ]]; then write_routes "$target"; fi
  compose up -d postgres
  wait_healthy postgres 180
  log "执行向前兼容的数据库迁移。"
  compose --profile "$target" run --rm --no-deps \
    "api-$target" node dist/cli/migrate.js
  compose --profile "$target" up -d --no-deps "api-$target" "web-$target"
  wait_healthy "api-$target" 180
  wait_healthy "web-$target" 180

  if [[ -z "$previous" ]]; then
    compose up -d caddy
    wait_healthy caddy 60
  else
    compose up -d caddy
    wait_healthy caddy 60
    reload_caddy_for_slot "$target" "$previous"
  fi

  if ! public_smoke; then
    if [[ -n "$previous" ]]; then
      warn "公网冒烟失败，立即把流量切回 $previous 槽。"
      reload_caddy_for_slot "$previous" "$target"
      compose --profile "$target" stop -t 30 "api-$target" "web-$target" || true
    fi
    die "HTTPS 公网健康检查失败；请核对 DNS、80/443、安全组和证书签发。"
  fi

  ACTIVE_SLOT=$target
  save_state
  bootstrap_admin "$target"
  if [[ -n "$previous" ]]; then
    log "切流成功；等待 30 秒让普通请求完成。SSE 客户端会按游标自动重连。"
    sleep 30
    compose --profile "$previous" stop -t 30 "api-$previous" "web-$previous"
  fi
  log "部署完成：$revision，活动槽：$ACTIVE_SLOT，https://$APP_HOST"
}

install_command() {
  [[ ! -f "$SETTINGS_FILE" ]] || die "已经安装；请使用 update 或 configure。"
  check_host
  install_docker
  configure_settings
  ensure_swap
  load_state
  render_runtime_envs
  sync_latest_commit
  deploy_release true
}

update_command() {
  load_settings
  load_state
  check_host
  install_docker
  ensure_swap
  render_runtime_envs
  sync_latest_commit
  deploy_release false
}

configure_command() {
  load_settings
  load_state
  check_host
  install_docker
  configure_settings
  ensure_swap
  render_runtime_envs
  sync_latest_commit
  deploy_release true
}

rollback_command() {
  load_settings
  load_state
  [[ "$ACTIVE_SLOT" == blue || "$ACTIVE_SLOT" == green ]] || die "没有可回滚的活动部署。"
  local target target_revision
  [[ "$ACTIVE_SLOT" == blue ]] && target=green || target=blue
  [[ "$target" == blue ]] && target_revision=$BLUE_REVISION || target_revision=$GREEN_REVISION
  [[ -n "$target_revision" ]] || die "上一槽没有部署记录。"
  render_runtime_envs
  compose up -d postgres caddy
  wait_healthy postgres 180
  wait_healthy caddy 60
  compose --profile "$target" up -d --no-deps "api-$target" "web-$target"
  wait_healthy "api-$target" 180
  wait_healthy "web-$target" 180
  local previous=$ACTIVE_SLOT
  reload_caddy_for_slot "$target" "$previous"
  if ! public_smoke; then
    warn "回滚槽公网冒烟失败，恢复 $previous 槽。"
    reload_caddy_for_slot "$previous" "$target"
    compose --profile "$target" stop -t 30 "api-$target" "web-$target" || true
    die "回滚槽公网健康检查失败，流量已恢复到原活动槽。"
  fi
  ACTIVE_SLOT=$target
  save_state
  sleep 15
  compose --profile "$previous" stop -t 30 "api-$previous" "web-$previous"
  log "已回滚到 $target 槽，提交 $target_revision。数据库迁移保持当前版本。"
}

status_command() {
  load_settings
  load_state
  printf '主站：https://%s\n活动槽：%s\n蓝槽提交：%s\n绿槽提交：%s\n' \
    "$APP_HOST" "${ACTIVE_SLOT:-未部署}" "${BLUE_REVISION:-无}" "${GREEN_REVISION:-无}"
  if command -v docker >/dev/null 2>&1 && [[ -f "$COMPOSE_ENV_FILE" ]]; then
    compose --profile blue --profile green ps
  fi
}

main() {
  local command=${1:-}
  case "$command" in help|-h|--help) usage; return ;; esac
  require_root
  acquire_lock
  if [[ -z "$command" ]]; then
    [[ -f "$SETTINGS_FILE" ]] && command=update || command=install
  fi
  case "$command" in
    install) install_command ;;
    update) update_command ;;
    configure) configure_command ;;
    rollback) rollback_command ;;
    status) status_command ;;
    *) usage; die "未知命令：$command" ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
