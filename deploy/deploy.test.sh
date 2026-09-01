#!/usr/bin/env bash
set -Eeuo pipefail

readonly TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
export PHOTOSTREAM_SETTINGS_DIR="$TEST_ROOT/etc"
export PHOTOSTREAM_STATE_DIR="$TEST_ROOT/state"
export PHOTOSTREAM_LOCK_FILE="$TEST_ROOT/deploy.lock"

# shellcheck source=deploy.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/deploy.sh"

# Git for Windows has no root account; production still executes the real chown on Debian.
chown() { :; }

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
mkdir -p -- "$SETTINGS_DIR" "$STATE_DIR"

set_slot_release blue abcdef123456
render_runtime_envs
write_routes blue

assert_file_contains "$API_ENV_FILE" 'DATABASE_URL=postgresql://photostream:database-secret@postgres:5432/photostream'
assert_file_contains "$WEB_ENV_FILE" 'MEDIA_BASE_URL=https://cdn.example.com'
assert_file_excludes "$WEB_ENV_FILE" 'database-secret'
assert_file_excludes "$WEB_ENV_FILE" 'exampleAccessSecret'
assert_file_contains "$CADDY_ENV_FILE" 'APP_HOST=photos.example.com'
assert_file_excludes "$CADDY_ENV_FILE" 'exampleAccessSecret'
assert_file_contains "$CADDY_STATE_DIR/active-public.caddy" 'reverse_proxy api-blue:3001'
assert_file_contains "$CADDY_STATE_DIR/active-public.caddy" 'reverse_proxy web-blue:3000'

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

printf 'deploy tests passed\n'
