#!/usr/bin/env bash
# Проба раздела промтов своей комнаты по паспорту (ADR-0012).
#
# Токен раздела лежит в НАШЕЙ комнате; читаем его паспортной сессией (писать
# ничего не нужно, но сессия — единственный способ уйти от статического токена
# на боксе) и спрашиваем `/api/prompts/section`. Наружу — код ответа и счётчик
# промтов; ни токен, ни тексты промтов в лог не печатаются.
#
# Вход (окружение): VAULT_BASE, PROJECT (по умолчанию vMalmyzhe),
# ACTIONS_ID_TOKEN_REQUEST_URL / _TOKEN.

set -euo pipefail

die() { echo "::error::$1" >&2; exit 1; }

[ -n "${VAULT_BASE:-}" ] || die "VAULT_BASE не задан"
PROJECT="${PROJECT:-vMalmyzhe}"
[ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] \
  || die "OIDC недоступен (нужен permissions: id-token: write)"

BASE="${VAULT_BASE%/}"
VAULT="$BASE/api/secrets"
TMPD="$(mktemp -d)"; chmod 700 "$TMPD"
SESSION_TOKEN=""

cleanup() {
  if [ -n "$SESSION_TOKEN" ]; then
    curl -sS -X DELETE "$VAULT/session" -H "Authorization: Bearer $SESSION_TOKEN" \
      --max-time 20 -o /dev/null -w 'DELETE /session → %{http_code}\n' 2>/dev/null || true
  fi
  rm -rf "$TMPD"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

ASSERTION="$(curl -sf -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=karman-vault" | jq -r '.value // empty')" \
  || die "удостоверение прогона не выдано"
[ -n "$ASSERTION" ] || die "удостоверение прогона не выдано"
echo "::add-mask::$ASSERTION"

SCODE="$(curl -s -o "$TMPD/session.json" -w '%{http_code}' --max-time 20 -X POST "$VAULT/session" \
  -H "Authorization: Bearer $ASSERTION" || echo 000)"
case "$SCODE" in
  201) ;;
  401) die "vault 401 — удостоверение отклонено (ветка не main / срок / повтор jti)" ;;
  403) die "vault 403 — личности Valstan/vMalmyzhe нет в реестре (ход владельца)" ;;
  *)   die "vault /session → $SCODE" ;;
esac
SESSION_TOKEN="$(jq -r '.token // empty' "$TMPD/session.json")"
rm -f "$TMPD/session.json"
[ -n "$SESSION_TOKEN" ] || die "201, но token пуст"
echo "::add-mask::$SESSION_TOKEN"

KEY=PROMPTS_TOKEN_VMALMYZHE
CODE="$(curl -s -o "$TMPD/secret.json" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $SESSION_TOKEN" "$VAULT?key=$KEY" || echo 000)"
if [ "$CODE" != "200" ]; then
  die "GET /api/secrets?key=$KEY → $CODE — токена раздела в комнате нет"
fi
VALUE="$(jq -r --arg k "$KEY" '.secrets[$k] // empty' "$TMPD/secret.json" | tr -d '\n')"
rm -f "$TMPD/secret.json"
[ -n "$VALUE" ] || die "комната ответила 200, но значения нет"
echo "::add-mask::$VALUE"
# Значение — в файл, а не в переменную: в argv не попадает.
printf '%s' "$VALUE" > "$TMPD/value"

# Значение уходит в curl через конфиг-файл: в argv не попадает.
{
  printf 'header = "Authorization: Bearer '
  cat "$TMPD/value"
  printf '"\n'
  printf 'url = "%s/api/prompts/section?project=%s"\n' "$BASE" "$PROJECT"
  printf 'silent\n'
  printf 'output = "%s"\n' "$TMPD/section.json"
  printf 'write-out = "%%{http_code}"\n'
  printf 'max-time = 20\n'
} > "$TMPD/curlcfg"

RCODE="$(curl -K "$TMPD/curlcfg")"
echo "GET /api/prompts/section?project=$PROJECT -> HTTP $RCODE"
case "$RCODE" in
  200)
    COUNT="$(jq -r '(.prompts // []) | length' "$TMPD/section.json" 2>/dev/null || echo '?')"
    echo "канал живой: раздел читается, промтов $COUNT"
    ;;
  503) echo "503 — канал не настроен: политика приёма не объявлена или выдача ещё pending" ;;
  403) echo "403 — токен не от того раздела" ;;
  404) echo "404 — раздела для проекта нет" ;;
  *)   echo "ответ: $(head -c 200 "$TMPD/section.json" 2>/dev/null | tr -d '\n')" ;;
esac
