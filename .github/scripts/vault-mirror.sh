#!/usr/bin/env bash
# Паспортное зеркало: положить НАШИ секреты в свою комнату vault по паспорту
# (ADR-0012, форма Б). Тогда пишущий токен на боксе не нужен вовсе — комнатный
# токен бокса остаётся read-only, как требует канон.
#
# Рецепт взят из гайда `karman/docs/passport-server.md` и из живого образца
# (Культура, деплой 01.10): весь обмен — в одном шаге, токен наружу не выходит,
# самоотзыв в trap, значения с бокса едут файлом, приёмка — эхо приёмника.
#
# Вход (окружение):
#   VAULT_BASE            — https://<хост KАРМАНа> (в лог не печатается)
#   PROD_ENV_FILE         — путь к prod-env на боксе
#   DEPLOY_HOST           — ssh-алиас бокса
#   ACTIONS_ID_TOKEN_REQUEST_URL / ACTIONS_ID_TOKEN_REQUEST_TOKEN — OIDC раннера
#
# Что печатается: коды, имена ключей, отпечатки sha256 (12 символов) и счётчики.
# Значения секретов в лог не попадают никогда.

set -euo pipefail

NAMES="${NAMES:-PAYLOAD_SECRET GATEWAY_KEY_VMALMYZHE INGEST_PUBLISH_KEY SARAFAN_GATEWAY_KEY PROMPTS_TOKEN_VMALMYZHE}"

die() { echo "::error::$1" >&2; exit 1; }
warn() { echo "::warning::$1" >&2; }

[ -n "${VAULT_BASE:-}" ] || die "VAULT_BASE не задан"
[ -n "${PROD_ENV_FILE:-}" ] || die "PROD_ENV_FILE не задан"
[ -n "${DEPLOY_HOST:-}" ] || die "DEPLOY_HOST не задан"
[ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] \
  || die "OIDC недоступен (нужен permissions: id-token: write)"

VAULT="${VAULT_BASE%/}/api/secrets"
TMPD="$(mktemp -d)"
chmod 700 "$TMPD"
SESSION_TOKEN=""

# ── ОДИН trap на шаг: отзыв сессии + уборка (G291: второй trap EXIT молча
# заменил бы первый — и сессия жила бы до конца TTL).
cleanup() {
  if [ -n "$SESSION_TOKEN" ]; then
    curl -sS -X DELETE "$VAULT/session" -H "Authorization: Bearer $SESSION_TOKEN" \
      --max-time 20 -o /dev/null -w 'DELETE /session → %{http_code}\n' 2>/dev/null || true
  fi
  [ -n "${BOX_FILE:-}" ] && ssh -o ConnectTimeout=10 "$DEPLOY_HOST" "rm -f '$BOX_FILE'" >/dev/null 2>&1 || true
  rm -rf "$TMPD"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

# ── 1. Удостоверение прогона → сессия своей комнаты ───────────────────────────
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
  429) die "vault 429 — рейт-лимит по claim'у, позже" ;;
  503) die "vault 503 — JWKS issuer'а недоступен" ;;
  *)   die "vault /session → $SCODE" ;;
esac
SESSION_TOKEN="$(jq -r '.token // empty' "$TMPD/session.json")"
CANWRITE="$(jq -r '.canWrite // false' "$TMPD/session.json")"
rm -f "$TMPD/session.json"
[ -n "$SESSION_TOKEN" ] || die "201, но token пуст"
echo "::add-mask::$SESSION_TOKEN"
[ "$CANWRITE" = "true" ] || die "сессия без права записи (canWrite=false) — зеркало невозможно"

# ── 2. Значения с бокса — файлом, не через stdout ─────────────────────────────
# Значения не печатаются: удалённый скрипт собирает их в файл 0600 и выдаёт
# ТОЛЬКО путь. Путь — не секрет, его можно показать.
BOX_FILE="$(ssh -o ConnectTimeout=15 "$DEPLOY_HOST" 'bash -s' "$PROD_ENV_FILE" "$NAMES" <<'REMOTE' 2>/dev/null
set -euo pipefail
ENV_FILE="$1"; NAMES="$2"
OUT="$(mktemp /tmp/vm-mirror.XXXXXX)"
chmod 600 "$OUT"
for NAME in $NAMES; do
  LINE="$(sudo -n grep "^$NAME=" "$ENV_FILE" 2>/dev/null | head -1 || true)"
  [ -n "$LINE" ] || continue
  VALUE="${LINE#*=}"
  # Кавычки срезаем, как это делает val() в старом шаге: иначе в комнату уехало бы
  # значение вместе с кавычками и подхват после восстановления было бы битым.
  VALUE="$(printf '%s' "$VALUE" | sed 's/^"\(.*\)"$/\1/')"
  printf '%s\t%s\n' "$NAME" "$VALUE" >> "$OUT"
done
echo "$OUT"
REMOTE
)" || die "не удалось прочитать prod-env с бокса"
[ -n "$BOX_FILE" ] || die "бокс не вернул файл со значениями"

scp -q "$DEPLOY_HOST:$BOX_FILE" "$TMPD/pairs.env" || die "scp не забрал файл с бокса"
ssh -o ConnectTimeout=10 "$DEPLOY_HOST" "rm -f '$BOX_FILE'" >/dev/null 2>&1 || true
BOX_FILE=""
[ -s "$TMPD/pairs.env" ] || { warn "зеркалить нечего — в prod-env нет ни одного из ключей"; exit 0; }

# ── 3. Тело запроса (файл, значение в argv не попадает) ──────────────────────
jq -R -s 'split("\n") | map(select(length > 0)) | map(split("\t")) | map({(.[0]): (.[1:] | join("\t"))}) | add' \
  < "$TMPD/pairs.env" > "$TMPD/mirror.json" || die "не собралось тело запроса"
jq -e 'type == "object" and (keys | length) > 0' "$TMPD/mirror.json" >/dev/null \
  || { warn "документ для комнаты пуст — не шлём"; exit 0; }
echo "к отправке ключей: $(jq -r '.secrets | keys | join(", ")' "$TMPD/mirror.json")"

# ── 4. Запись паспортной сессией ──────────────────────────────────────────────
CODE="$(curl -s -o "$TMPD/out.txt" -w '%{http_code}' --max-time 20 -X POST "$VAULT" \
  -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @"$TMPD/mirror.json" || echo 000)"
case "$CODE" in
  2*) echo "запись принята (HTTP $CODE)" ;;
  401|403) die "HTTP $CODE — сессия не пишет в комнату" ;;
  *)   die "комната не приняла запись, HTTP $CODE" ;;
esac

# ── 5. Приёмка — эхо приёмника, а не «запись принята» (#110) ─────────────────
bad=0
while IFS=$'\t' read -r NAME VALUE; do
  [ -n "$NAME" ] || continue
  echo "::add-mask::$VALUE"
  MINE="$(printf '%s' "$VALUE" | sha256sum | cut -c1-12)"
  RESP="$(curl -sf --max-time 15 -H "Authorization: Bearer $SESSION_TOKEN" "$VAULT?key=$NAME" || true)"
  if [ -z "$RESP" ]; then
    warn "$NAME: комната не отдала значение — эхо не сверено"; bad=$((bad + 1)); continue
  fi
  THEIRS="$(printf '%s' "$RESP" | jq -r --arg n "$NAME" '.secrets[$n] // empty' | tr -d '\n' | sha256sum | cut -c1-12)"
  if [ "$MINE" = "$THEIRS" ]; then
    echo "$NAME: эхо совпало ($MINE)"
  else
    warn "$NAME: эхо НЕ совпало ($MINE vs $THEIRS)"; bad=$((bad + 1))
  fi
done < "$TMPD/pairs.env"

[ "$bad" -eq 0 ] || die "эхо не сошлось по $bad ключам — DR-копия секретов в комнате не подтверждена"
echo "эхо сошлось по всем зеркалируемым ключам"
