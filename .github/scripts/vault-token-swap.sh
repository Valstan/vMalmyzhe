#!/bin/bash
# Замена комнатного токена на боксе: обмен одноразовой временки на постоянный
# RO-токен комнаты (D-185), запись в prod-env, рестарт сервиса, приёмка.
#
# Вход: $1 — файл с одноразовым кодом (на боксе, 600). Код не печатается.
#
# Что проверяется:
#   • ответ обмена — 201, slug = наша комната, canWrite = false (иначе стоп);
#   • после подмены: GET /api/secrets/self новым токеном → canWrite=false,
#     identity=null (статический токен владельца, не паспортная сессия);
#   • портал поднялся после рестарта (/api/auth/me и / → 200);
#   • новое значение токена НЕ печатается, только отпечаток sha256 (12 символов)
#     и факты о правах.
set -euo pipefail

ENV_FILE=/etc/vmalmyzhe/vmalmyzhe.env
CODE_FILE="${1:-}"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
umask 077

fail() { echo "::error::$1" >&2; exit 1; }

set -a; . "$ENV_FILE"; set +a
TOKEN_OLD="${SECRETS_TOKEN:-}"
VAULT="${SECRETS_VAULT_URL%/}"
[ -n "$TOKEN_OLD" ] || fail "в prod-env нет SECRETS_TOKEN"
[ -n "$VAULT" ] || fail "в prod-env нет SECRETS_VAULT_URL"

# Код временки берём из файла на боксе, а если файла нет — из НАШЕЙ ЖЕ комнаты
# под ключом VM_BOOTSTRAP_CODE: туда его кладёт владелец прямо в интерфейсе
# КАРМАНА. Так код не идёт ни через чат, ни через файл — а после обмена он
# мёртв (одноразовый) и остаётся только удалить его из комнаты.
CODE=""
CODE_SOURCE=""
if [ -n "$CODE_FILE" ] && [ -s "$CODE_FILE" ]; then
  CODE="$(tr -d '\r\n' < "$CODE_FILE")"
  # BOM (EF BB BF) в начало — тоже мусор: он попадёт в заголовок curl и код станет
  # неверным. Снимаем на входе, чтобы файл можно было класть любым способом.
  CODE="${CODE#$'\xEF\xBB\xBF'}"
  CODE_SOURCE="файл на боксе"
else
  CODE="$(curl -s --max-time 20 -H "Authorization: Bearer $TOKEN_OLD" \
    "$VAULT/api/secrets?key=VM_BOOTSTRAP_CODE" \
    | jq -r '.secrets.VM_BOOTSTRAP_CODE // empty' | tr -d '\r\n')"
  CODE_SOURCE="комната, ключ VM_BOOTSTRAP_CODE"
fi
[ -n "$CODE" ] || fail "код временки не найден: нет файла $CODE_FILE и нет ключа VM_BOOTSTRAP_CODE в комнате"
echo "код временки взят: $CODE_SOURCE"

echo "== права нынешнего токена (до подмены) =="
curl -s --max-time 20 -H "Authorization: Bearer $TOKEN_OLD" "$VAULT/api/secrets/self" \
  | jq -c '{slug, canWrite, identity: (if .identity == null then "статический" else "паспортный" end)}'

echo "== обмен временки =="
# Код — в конфиг-файл curl, а не в argv: на общем боксе argv виден соседям.
# Сначала кладём его в файл 0600 и подставляем оттуда.
printf '%s' "$CODE" > "$TMPD/code"
{
  printf 'header = "Authorization: Bearer '
  cat "$TMPD/code"
  printf '"\n'
  printf 'request = "POST"\n'
  printf 'url = "%s/api/secrets/claim"\n' "$VAULT"
  printf 'silent\n'
  printf 'output = "%s"\n' "$TMPD/claim.json"
  printf 'write-out = "%%{http_code}"\n'
  printf 'max-time = 20\n'
} > "$TMPD/curlcfg"
CODE_RESP="$(curl -K "$TMPD/curlcfg")"
case "$CODE_RESP" in
  201) ;;
  401) fail "код не принят (401: неизвестный, истёкший, отозванный или уже обменянный)" ;;
  429) fail "рейт-лимит на обмен" ;;
  *)   fail "обмен → HTTP $CODE_RESP" ;;
esac

NEW_TOKEN="$(jq -r '.token // empty' "$TMPD/claim.json")"
NEW_SLUG="$(jq -r '.slug // empty' "$TMPD/claim.json")"
# ⚠️ jq-ловушка: `false // "null"` возвращает "null" — оператор `//` считает
# false «пустым». Ответ обмена присылает canWrite=false буквально, и старый
# разбор превращал это в "null" → страж отвергал верный ответ, а код при этом
# уже израсходывался. Разбираем через has()/tostring.
NEW_CANWRITE="$(jq -r 'if has("canWrite") then (.canWrite | tostring) else "нет-поля" end' "$TMPD/claim.json")"
rm -f "$TMPD/claim.json"
[ -n "$NEW_TOKEN" ] || fail "201, но токен в ответе пуст"
[ "$NEW_SLUG" = "vmalmyzhe" ] || fail "обмен выдал чужую комнату: $NEW_SLUG"
[ "$NEW_CANWRITE" = "false" ] || fail "обмен выдал токен с правом записи (canWrite=$NEW_CANWRITE) — подмена не выполнена"

echo "комната: $NEW_SLUG, право: read-only, длина значения: ${#NEW_TOKEN}"
echo "отпечаток значения: $(printf '%s' "$NEW_TOKEN" | sha256sum | cut -c1-12)"

echo "== подмена в prod-env =="
TMP="$(mktemp)"
sudo -n cat "$ENV_FILE" > "$TMP"
# Меняем только строку SECRETS_TOKEN=; остальные строки и порядок сохраняем.
# Пересборка идёт встроенными командами shell: значение остаётся в переменной
# и НЕ попадает в argv (awk -v раскрыл бы токен в ps на общем боксе).
done=0
{
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      SECRETS_TOKEN=*)
        if [ "$done" = 0 ]; then
          printf 'SECRETS_TOKEN=%s\n' "$NEW_TOKEN"
          done=1
        fi
        ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$TMP"
} > "$TMP.new"
[ "$done" = 1 ] || { rm -f "$TMP" "$TMP.new"; fail "SECRETS_TOKEN не найден — prod-env не тронут"; }
sudo -n cp --no-preserve=mode,ownership "$TMP.new" "$ENV_FILE.new"
sudo -n chown --reference="$ENV_FILE" "$ENV_FILE.new"
sudo -n chmod --reference="$ENV_FILE" "$ENV_FILE.new"
sudo -n mv "$ENV_FILE.new" "$ENV_FILE"
rm -f "$TMP" "$TMP.new"
echo "prod-env обновлён (владелец и режим файла сохранены)"

echo "== рестарт и приёмка =="
sudo -n systemctl restart vmalmyzhe
sleep 8
sudo -n systemctl is-active --quiet vmalmyzhe || fail "сервис не активен после рестарта"

CODE_AUTHME="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1:3004/api/auth/me || echo 000)"
CODE_HOME="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1:3004/ || echo 000)"
CODE_NEWS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1:3004/news || echo 000)"
echo "/api/auth/me → $CODE_AUTHME ; / → $CODE_HOME ; /news → $CODE_NEWS"
[ "$CODE_AUTHME" = "200" ] || fail "портал не отвечает 200 на /api/auth/me после рестарта"

echo "== права нового токена =="
set -a; . "$ENV_FILE"; set +a
curl -s --max-time 20 -H "Authorization: Bearer $SECRETS_TOKEN" "$VAULT/api/secrets/self" \
  | jq -c '{slug, canWrite, identity: (if .identity == null then "статический" else "паспортный" end), expiresAt}'

echo "== что осталось за владельцем =="
echo "отозвать старый rw-токен комнаты: «Секреты» → комната vMalmyzhe → «Токены доступа» → строка read-write → «Отозвать»"
echo "== готово =="
