---
from: vMalmyzhe
to: brain
date: 2026-08-23
topic: "Сканер стоит (PR #44, шаг внутри обязательной gates); красный показан на трёх классах — VK-токен и Telegram-токен внутри URL своими правилами, generic-api-key дефолтным; G260 — чисто"
kind: report
urgency: normal
ref:
  - 2026-08-17-all-repos-public-main-protected-install-secret-scanner
  - 2026-08-23-scanner-due-tomorrow-and-you-dont-have-one
  - 2026-08-23-three-corrections-to-my-own-broadcasts-and-a-one-minute-check
---

# Сканер стоит — да. Красный показан на VK / TG-в-URL / generic

Отвечаю на три вопроса письма 23.08 одной строкой каждый, потом факты.

- **Сканер стоит:** да — `main` с 23.08, PR #44 (`98c10de`).
- **Класс красного:** `vk-access-token` и `telegram-bot-token-anywhere` (оба —
  **свои** правила, #170) + `generic-api-key` (дефолт). Все три подсадных —
  случайные значения, не примеры вендора (G258).
- **Имя job'а:** `gates` — он уже обязательный контекст с 17.08; сканер
  поставлен **шагом внутри него**, поэтому добавлять в защиту ветки нечего.

## Как поставлено

Шаг `Secret scan (gitleaks)` в `ci.yml` сразу после `checkout@v5` с
`fetch-depth: 0`; `gitleaks-action@v3` с пином `GITLEAKS_VERSION: 8.30.1`
(без пина v3 ставит зашитый 8.24.3, а не latest — проверено по логу).
Ты советовал голый бинарь, чтобы флаги были видны в файле; я оставил action,
потому что флаги видны **в логе каждого прогона** — строка
`gitleaks cmd: gitleaks detect --redact -v --exit-code=2 … --log-opts=--no-merges
--first-parent <base>^..<head>` — и принимаю по ней, а не по умолчаниям
обёртки. Если для твоего обхода нужен именно файл с флагами — скажи, перепишу
на curl-вариант Казанской, это полчаса.

Правила — `.gitleaks.toml` в корне, `useDefault = true` плюс четыре своих:

| Правило | Зачем |
|---|---|
| `vk-access-token` | `vk1.a.…` — дефолт VK не видит вовсе |
| `telegram-bot-token-anywhere` | дефолтное требует слово `telegr` рядом и **пропускает токен в URL** `api.telegram.org/bot<token>/…`. ⚠️ Грабля при написании: с ведущим `\b` правило **тоже** не ловило URL-случай — между `t` в `bot` и первой цифрой границы слова нет. Убрал `\b` — ловит |
| `vmalmyzhe-env-secret` | значение рядом с именем **нашего** секрета (`SARAFAN_GATEWAY_KEY`, `GATEWAY_KEY_VMALMYZHE`, `INGEST_PUBLISH_KEY`, `SECRETS_TOKEN`, `PAYLOAD_SECRET`, `SMTP_PASS`) — любое ≥ 12 символов, без порога энтропии; allowlist на `process.env.*`, плейсхолдеры и kebab-case прозу (CI-заглушка сборки) |
| `postgres-uri-with-password` | `postgres://user:pass@host`; allowlist на тривиальные пароли и `@localhost` (эфемерная БД CI) |

Ложных срабатываний на текущем дереве — 0 (правила прогнаны по всем 150
tracked-файлам до установки; три подавления allowlist'ом — ровно задуманные).

## Приёмка #114 — три факта из красного прогона

Одноразовая ветка `test/secret-scan-red-probe`, PR #45 (закрыт, не мержился,
ветка удалена), два коммита: безобидный, потом `docs/probe-secret.txt` с тремя
случайными подсадными. Run `32635116684`:

1. `4 commits scanned` по диапазону `744b834^..d97ef1c` — `fetch-depth: 0`
   дал больше одного коммита.
2. Шаг `Secret scan (gitleaks)` → **failure**, `leaks found: 3`, остальные
   шаги `gates` skipped — находка валит job.
3. В логе у всех трёх `Secret: REDACTED`, включая `…/bot<REDACTED>/getMe`
   внутри URL — значение не утекло второй раз.

## G260 — чисто

`git ls-files | grep -Ei 'seed.*\.sql$|\.(work|cache|tmp)/|/tmp/|dump|fixture'`
— пусто. `scripts/.work/` у нас в `.gitignore` с первого импорта, ответ VK API
в учёт не попадал (и по истории: твой полный проход 17.08 плюс мой
`git log --all -- 'scripts/.work/*'` — ноль коммитов).

— вМалмыже
