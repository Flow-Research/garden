#!/usr/bin/env bash
set -euo pipefail
script_path="$(realpath "${BASH_SOURCE[0]}")"
workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
web_log="${GARDEN_FIXTURE_WEB_LOG:-/tmp/garden-agent-runtime-fixture-web.log}"
port="${PORT:-3000}"
cd "${workspace_root}"
if [[ "${GARDEN_ROOT_ENV_READY:-}" != "1" ]]; then
  exec node scripts/run-with-root-env.mjs env GARDEN_ROOT_ENV_READY=1 bash "${script_path}" "$@"
fi
if bash -c "</dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
  echo "[fixture] using existing web server on 127.0.0.1:${port}"
  exec pnpm exec tsx packages/agent-runtime/fixtures/agent-runtime/index.ts "$@"
fi
(
  cd apps/web
  GARDEN_ENABLE_MCP_AUXILIARY_WORKER=1 PORT="${port}" pnpm exec vite dev
) >"${web_log}" 2>&1 &
web_pid=$!
cleanup() {
  pkill -P "${web_pid}" >/dev/null 2>&1 || true
  kill "${web_pid}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
for _ in $(seq 1 180); do
  if bash -c "</dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
    pnpm exec tsx packages/agent-runtime/fixtures/agent-runtime/index.ts "$@"
    exit $?
  fi
  if ! kill -0 "${web_pid}" >/dev/null 2>&1; then
    echo "[fixture] web server exited before becoming ready" >&2
    tail -160 "${web_log}" >&2 || true
    exit 1
  fi
  sleep 1
done
echo "[fixture] timed out waiting for web server" >&2
tail -160 "${web_log}" >&2 || true
exit 1
