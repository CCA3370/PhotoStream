#!/usr/bin/env bash
set -Eeuo pipefail

readonly TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
export PHOTOSTREAM_SETTINGS_DIR="$TEST_ROOT/etc"
export PHOTOSTREAM_STATE_DIR="$TEST_ROOT/state"
export PHOTOSTREAM_LOCK_FILE="$TEST_ROOT/deploy.lock"
export PHOTOSTREAM_PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

# shellcheck source=deploy.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/deploy.sh"

# Git for Windows has no root account; production still executes the real chown on Debian.
chown() { :; }
# Git for Windows does not ship flock; Linux locking is exercised on the Debian target.
flock() { :; }

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_file_contains() { grep -qF -- "$2" "$1" || fail "$1 does not contain $2"; }
assert_file_excludes() { ! grep -qF -- "$2" "$1" || fail "$1 unexpectedly contains $2"; }

APP_HOST=photos.example.com
ACME_EMAIL=ops@example.com
MEDIA_BASE_URL=https://cdn.example.com
ALIYUN_OSS_MEDIA_BUCKET=media-private-test
ALIYUN_ACCESS_KEY_ID=exampleAccessKey
ALIYUN_ACCESS_KEY_SECRET=exampleAccessSecret
ALIYUN_CDN_AUTH_KEY_CURRENT=0123456789abcdef0123456789abcdef
POSTGRES_PASSWORD=database-secret
SESSION_SECRET_CURRENT=session-secret-session-secret-1234
CSRF_SECRET=csrf-secret-csrf-secret-12345678
CURSOR_SIGNING_SECRET=cursor-secret-cursor-secret-1234
VISITOR_SESSION_SECRET=visitor-secret-visitor-secret-123
ALBUM_PASSWORD_GENERATION_SECRET=album-secret-album-secret-123456
USER_PASSWORD_GENERATION_SECRET=user-secret-user-secret-12345678
ANALYTICS_HMAC_SECRET=analytics-secret-analytics-secret-12
BIB_DATA_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
BIB_SEARCH_KEY=bib-search-secret-bib-search-secret
EVENTBRIDGE_SIGNATURE_TOKEN=eventbridge-secret-eventbridge-secret
GIT_REPOSITORY_URL=https://git.example.com/photostream.git
GIT_REMOTE=origin
GIT_BRANCH=main
SETTINGS_VERSION=3
mkdir -p -- "$SETTINGS_DIR" "$STATE_DIR"

save_settings
assert_file_contains "$SETTINGS_FILE" 'SETTINGS_VERSION=3'
assert_file_contains "$SETTINGS_FILE" 'GIT_REPOSITORY_URL=https://git.example.com/photostream.git'
GIT_REPOSITORY_URL=''
GIT_BRANCH=''
# Git for Windows cannot emulate root ownership; source the generated file directly here.
# shellcheck source=/dev/null
source "$SETTINGS_FILE"
[[ "$GIT_REPOSITORY_URL" == https://git.example.com/photostream.git ]] || \
  fail 'saved repository URL was not restored'
[[ "$GIT_BRANCH" == main ]] || fail 'saved repository branch was not restored'
if (
  SETTINGS_VERSION=2
  require_current_settings_version
) 2>/dev/null; then
  fail 'legacy Hangzhou settings must require explicit reconfiguration'
fi

(
  exec 9>"$LOCK_FILE"
  PHOTOSTREAM_LOCK_INHERITED=true
  acquire_lock
)

if ! (
  CREATE_SWAP=false
  ensure_swap
); then
  fail 'ensure_swap must succeed when swap creation is disabled'
fi
if ! (
  CREATE_SWAP=true
  swapon() { printf '/swapfile\n'; }
  ensure_swap
); then
  fail 'ensure_swap must succeed when swap is already active'
fi
if ! (
  ADMIN_BOOTSTRAPPED=true
  compose() { fail 'bootstrap_admin invoked compose after initialization'; }
  bootstrap_admin blue
); then
  fail 'bootstrap_admin must succeed when the administrator already exists'
fi

set_slot_release blue abcdef123456
render_runtime_envs
write_routes blue

assert_file_contains "$API_ENV_FILE" 'DATABASE_URL=postgresql://photostream:database-secret@postgres:5432/photostream'
assert_file_contains "$API_ENV_FILE" 'ALIYUN_OSS_REGION=oss-cn-beijing'
assert_file_contains "$API_ENV_FILE" 'ALIYUN_OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com'
assert_file_contains "$API_ENV_FILE" 'ALIYUN_IMM_REGION=cn-beijing'
assert_file_contains "$WEB_ENV_FILE" 'MEDIA_BASE_URL=https://cdn.example.com'
assert_file_contains "$WEB_ENV_FILE" 'PHOTO_UPLOAD_BASE_URL=https://media-private-test.oss-cn-beijing.aliyuncs.com'
assert_file_excludes "$WEB_ENV_FILE" 'database-secret'
assert_file_excludes "$WEB_ENV_FILE" 'exampleAccessSecret'
assert_file_contains "$CADDY_ENV_FILE" 'APP_HOST=photos.example.com'
assert_file_excludes "$CADDY_ENV_FILE" 'exampleAccessSecret'
assert_file_contains "$CADDY_STATE_DIR/active-public.caddy" 'reverse_proxy api-blue:3001'
assert_file_contains "$CADDY_STATE_DIR/active-public.caddy" 'reverse_proxy web-blue:3000'
assert_file_contains "$CADDY_STATE_DIR/active-api.caddy" 'reverse_proxy api-blue:3001'
assert_file_contains "$CADDY_STATE_DIR/active-api.caddy" 'header_up Host photos.example.com'
assert_file_excludes "$CADDY_STATE_DIR/active-api.caddy" 'reverse_proxy api-green:3001'
assert_file_excludes "$CADDY_STATE_DIR/active-public.caddy" 'header_up Host'

write_routes green
assert_file_contains "$CADDY_STATE_DIR/active-api.caddy" 'reverse_proxy api-green:3001'
assert_file_contains "$CADDY_STATE_DIR/active-api.caddy" 'header_up Host photos.example.com'
assert_file_excludes "$CADDY_STATE_DIR/active-api.caddy" 'reverse_proxy api-blue:3001'
write_routes blue

rollback_trace="$TEST_ROOT/rollback.trace"
if (
  ACTIVE_SLOT=blue
  GREEN_REVISION=previous-release
  load_settings() { :; }
  load_state() { :; }
  render_runtime_envs() { :; }
  compose() { printf 'compose' >>"$rollback_trace"; printf ' <%s>' "$@" >>"$rollback_trace"; printf '\n' >>"$rollback_trace"; }
  wait_healthy() { :; }
  reload_caddy_for_slot() { printf 'reload %s:%s\n' "$1" "$2" >>"$rollback_trace"; }
  public_smoke() { return 1; }
  save_state() { :; }
  warn() { :; }
  die() { exit 97; }
  rollback_command
); then
  fail 'rollback must fail when the target public smoke check fails'
fi
assert_file_contains "$rollback_trace" 'reload green:blue'
assert_file_contains "$rollback_trace" 'reload blue:green'
assert_file_contains "$rollback_trace" 'compose <--profile> <green> <stop>'

bootstrap_source="$TEST_ROOT/bootstrap-source"
bootstrap_target="$TEST_ROOT/managed checkout"
bootstrap_launcher_dir="$TEST_ROOT/arbitrary launcher"
bootstrap_cwd="$TEST_ROOT/unrelated cwd"
bootstrap_settings="$TEST_ROOT/bootstrap-etc"
mkdir -p -- "$bootstrap_source/deploy" "$bootstrap_launcher_dir" "$bootstrap_cwd"
cp -- "$(dirname -- "${BASH_SOURCE[0]}")/deploy.sh" "$bootstrap_source/deploy/deploy.sh"
touch "$bootstrap_source/Dockerfile" "$bootstrap_source/compose.production.yml"
git -C "$bootstrap_source" init --initial-branch=main --quiet
git -C "$bootstrap_source" config user.email test@example.com
git -C "$bootstrap_source" config user.name 'PhotoStream deploy test'
git -C "$bootstrap_source" config core.autocrlf false
git -C "$bootstrap_source" add deploy/deploy.sh Dockerfile compose.production.yml
git -C "$bootstrap_source" commit --quiet -m 'test fixture'
cp -- "$(dirname -- "${BASH_SOURCE[0]}")/deploy.sh" "$bootstrap_launcher_dir/deploy.sh"

(
  cd -- "$bootstrap_cwd"
  PHOTOSTREAM_PROJECT_DIR="$bootstrap_target" \
    PHOTOSTREAM_SETTINGS_DIR="$bootstrap_settings" \
    PHOTOSTREAM_BOOTSTRAP_REPOSITORY_URL="$bootstrap_source" \
    PHOTOSTREAM_BOOTSTRAP_BRANCH=main \
    bash -c 'source "$1"; ensure_managed_checkout' _ "$bootstrap_launcher_dir/deploy.sh"
)
[[ -d "$bootstrap_target/.git" ]] || fail 'bootstrap did not clone the managed repository'
bootstrap_remote=$(git -C "$bootstrap_target" remote get-url origin)
[[ "$(cd -- "$bootstrap_remote" && pwd -P)" == "$(cd -- "$bootstrap_source" && pwd -P)" ]] || \
  fail 'bootstrap clone uses the wrong origin URL'
[[ -f "$bootstrap_target/deploy/deploy.sh" ]] || fail 'managed deploy entrypoint is missing'
[[ -z $(find "$bootstrap_cwd" -mindepth 1 -print -quit) ]] || fail 'bootstrap wrote into the caller working directory'

first_checkout_revision=$(git -C "$bootstrap_target" rev-parse HEAD)
(
  cd -- "$bootstrap_launcher_dir"
  PHOTOSTREAM_PROJECT_DIR="$bootstrap_target" \
    PHOTOSTREAM_SETTINGS_DIR="$bootstrap_settings" \
    PHOTOSTREAM_BOOTSTRAP_REPOSITORY_URL="$bootstrap_source" \
    PHOTOSTREAM_BOOTSTRAP_BRANCH=main \
    bash -c 'source "$1"; ensure_managed_checkout' _ "$bootstrap_launcher_dir/deploy.sh"
)
[[ $(git -C "$bootstrap_target" rev-parse HEAD) == "$first_checkout_revision" ]] || \
  fail 'bootstrap changed an existing managed checkout'

handoff_trace="$TEST_ROOT/handoff.trace"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  ': >&9 || exit 96' \
  'printf "project=%s\n" "$PHOTOSTREAM_PROJECT_DIR" >"$PHOTOSTREAM_HANDOFF_TRACE"' \
  'printf "lock=inherited\n" >>"$PHOTOSTREAM_HANDOFF_TRACE"' \
  'printf "pwd=%s\n" "$PWD" >>"$PHOTOSTREAM_HANDOFF_TRACE"' \
  'printf "arg=%s\n" "$@" >>"$PHOTOSTREAM_HANDOFF_TRACE"' \
  >"$bootstrap_target/deploy/deploy.sh"
chmod +x "$bootstrap_target/deploy/deploy.sh"
(
  cd -- "$bootstrap_cwd"
  exec 9>"$TEST_ROOT/handoff.lock"
  PHOTOSTREAM_PROJECT_DIR="$bootstrap_target" \
    PHOTOSTREAM_SETTINGS_DIR="$bootstrap_settings" \
    PHOTOSTREAM_BOOTSTRAP_REPOSITORY_URL="$bootstrap_source" \
    PHOTOSTREAM_BOOTSTRAP_BRANCH=main \
    PHOTOSTREAM_HANDOFF_TRACE="$handoff_trace" \
    bash -c 'source "$1"; handoff_to_managed_checkout update' _ "$bootstrap_launcher_dir/deploy.sh"
)
assert_file_contains "$handoff_trace" "project=$bootstrap_target"
assert_file_contains "$handoff_trace" 'lock=inherited'
assert_file_contains "$handoff_trace" "pwd=$bootstrap_cwd"
assert_file_contains "$handoff_trace" 'arg=update'

invalid_target="$TEST_ROOT/nonempty target"
mkdir -p -- "$invalid_target"
touch "$invalid_target/unrelated.txt"
if PHOTOSTREAM_PROJECT_DIR="$invalid_target" \
  PHOTOSTREAM_SETTINGS_DIR="$bootstrap_settings" \
  PHOTOSTREAM_BOOTSTRAP_REPOSITORY_URL="$bootstrap_source" \
  PHOTOSTREAM_BOOTSTRAP_BRANCH=main \
  bash -c 'source "$1"; ensure_managed_checkout' _ "$bootstrap_launcher_dir/deploy.sh" 2>/dev/null; then
  fail 'bootstrap must reject a nonempty non-Git target directory'
fi

for valid_repository_url in \
  https://git.example.com/photostream.git \
  ssh://git@git.example.com/photostream.git \
  git@git.example.com:school/photostream.git \
  /srv/git/photostream.git; do
  repository_url_is_valid "$valid_repository_url" || \
    fail "repository validation rejected $valid_repository_url"
done
if repository_url_is_valid relative/repository; then
  fail 'repository validation must reject caller-relative paths'
fi

printf 'deploy tests passed\n'
