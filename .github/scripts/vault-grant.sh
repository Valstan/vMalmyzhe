#!/usr/bin/env bash
# Операции с выдачами (grants) в своей комнате vault — ПАСПОРТОМ (ADR-0012).
#
# Почему паспортом, а не комнатным токеном: `POST /api/secrets/grants` требует
# права записи (у ro-токена 403 «Выдавать доступ может только токен с правом
# записи»), а канон требует, чтобы комнатный токен на боксе оставался
# read-only. Значит все выдачи делает сессия, открытая по удостоверению прогона.
#
# Рецепт — из гайда `karman/docs/passport-server.md`: весь обмен в одном шаге,
# токен наружу не выходит, самоотзыв в trap, `::add-mask::` до первого
# использования, наружу — только поля по именам, никогда тело ответа целиком.
#
# Вход (окружение):
#   VAULT_BASE  — https://<хост KАРМАНа>
#   MODE        — status | propose | revoke
#   KEY         — имя ключа своей комнаты (для propose)
#   ALIAS       — имя, под которым ключ увидит получатель (для propose)
#   TARGET      — slug комнаты-получателя; если пусто — берётся из нашей же
#                 выдачи по этому ключу (чтобы чужой slug не жёстко жил в коде)
#   NOTE        — основание (для propose)
#   GRANT_ID    — id выдачи (для revoke)
#   ACTIONS_ID_TOKEN_REQUEST_URL / _TOKEN — OIDC раннера

set -euo pipefail

die() { echo "::error::$1" >&2; exit 1; }

[ -n "${VAULT_BASE:-}" ] || die "VAULT_BASE не задан"
MODE="${MODE:-status}"
[ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] \
  || die "OIDC недоступен (нужен permissions: id-token: write)"

VAULT="${VAULT_BASE%/}/api/secrets"
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

# ── сессия своей комнаты по паспорту ──────────────────────────────────────────
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
echo "сессия своей комнаты открыта (canWrite=$CANWRITE)"

grants() { curl -sf --max-time 15 -H "Authorization: Bearer $SESSION_TOKEN" "$VAULT/grants"; }

show() {
  grants | jq -r '"issued:", (.issued[]? | "  #\(.id) \(.sourceKey) -> \(.targetSlug) as \(.aliasKey // .sourceKey) [\(.state)] accepted=\(.acceptedAt // "-") revoked=\(.revokedAt // "-")"),
                   "received:", (.received[]? | "  #\(.id) \(.aliasKey) <- \(.sourceSlug) [\(.state)]")'
}

case "$MODE" in
  status)
    show
    ;;

  propose)
    KEY="${KEY:-}"; ALIAS="${ALIAS:-$KEY}"
    [ -n "$KEY" ] || die "KEY не задан"
    TARGET="${TARGET:-}"
    if [ -z "$TARGET" ]; then
      # Адресат — из нашей же выдачи по этому ключу: чужой slug в коде не живёт.
      TARGET="$(grants | jq -r --arg k "$KEY" '[.issued[]? | select(.sourceKey == $k and (.revokedAt == null))] | (.[0].targetSlug // empty)')"
      [ -n "$TARGET" ] || die "адресат неизвестен: нет нашей выдачи по ключу $KEY — задай TARGET явно"
    fi
    [ "$CANWRITE" = "true" ] || die "сессия без права записи — выдачу не предложить"
    jq -n --arg k "$KEY" --arg t "$TARGET" --arg a "$ALIAS" --arg n "${NOTE:-}" \
      '{key:$k,target_slug:$t,alias:$a,note:$n}' > "$TMPD/body.json"
    CODE="$(curl -s -o "$TMPD/grant.json" -w '%{http_code}' --max-time 15 -X POST "$VAULT/grants" \
      -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
      --data-binary @"$TMPD/body.json" || echo 000)"
    echo "предложение выдачи: HTTP $CODE"
    case "$CODE" in
      201) jq -c '{id,state}' "$TMPD/grant.json" ;;
      409) echo "409 — такая выдача уже есть (или имя у получателя занято); состояние ниже" ;;
      403) die "403 — сессия не может предлагать выдачу" ;;
      404) die "404 — комната-получатель не найдена" ;;
      *)   die "HTTP $CODE от /api/secrets/grants" ;;
    esac
    show
    ;;

  revoke)
    [ "${GRANT_ID:-0}" != "0" ] || die "revoke без GRANT_ID"
    jq -n --argjson id "$GRANT_ID" '{id:$id}' > "$TMPD/revoke.json"
    curl -sf --max-time 15 -X DELETE "$VAULT/grants" \
      -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
      --data-binary @"$TMPD/revoke.json" | jq -c '.' || die "отзыв не прошёл"
    show
    ;;

  *) die "неизвестный MODE=$MODE" ;;
esac
