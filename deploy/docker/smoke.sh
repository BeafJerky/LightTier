#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PASSWORD="${LT_TEST_PASSWORD:-lighttier-test-123456}"
BASE="http://127.0.0.1:17800"
ORIGIN="$BASE"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

docker compose up -d --build

for _ in $(seq 1 90); do
  if curl -fsS "$BASE/api/v1/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "health: $(curl -fsS "$BASE/api/v1/healthz")"
echo "meta:   $(curl -fsS "$BASE/api/v1/meta")"

if curl -fsS "$BASE/api/v1/meta" | grep -q '"setupRequired":true'; then
  TOKEN="$(docker compose exec -T lighttier cat /data/state/setup-token | tr -d '\r\n')"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/auth/setup" \
    -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
    -d "{\"token\":\"$TOKEN\",\"password\":\"$PASSWORD\"}" -c "$COOKIE")"
  test "$code" = "204"
else
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/auth/login" \
    -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
    -d "{\"password\":\"$PASSWORD\"}" -c "$COOKIE")"
  test "$code" = "200"
fi

echo "session: $(curl -fsS -b "$COOKIE" "$BASE/api/v1/auth/session")"
configs="$(curl -fsS -b "$COOKIE" "$BASE/api/v1/configs")"
echo "configs:   $configs"
instances="$(curl -fsS -b "$COOKIE" "$BASE/api/v1/instances")"
echo "instances: $instances"
settings="$(curl -fsS -b "$COOKIE" "$BASE/api/v1/settings")"
echo "settings:  $settings"
echo "OK: open $BASE in a browser (M1 diagnostic page; M2 API is live)."