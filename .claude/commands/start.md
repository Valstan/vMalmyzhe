---
description: Старт сессии «вМалмыже» — синхра репо (#032) + mailbox-check от brain + чтение SESSION_HANDOFF
---

Выполни старт сессии «вМалмыже» строго по шагам (детали — в `AGENTS.md` §Mailbox). Порядок жёсткий: **сначала синхронизация своего репо (шаг 1), потом чтение session-памяти (шаг 4)** — pool #032.

1. **Sync свой репо — ПЕРВЫМ и ТОЛЬКО ЕГО:** `git fetch`; если working tree чист и есть отставание — `git checkout main && git pull --ff-only`. Незакоммиченное / не-ff — сообщи и не форсируй. Соседние репозитории, включая `brain_matrica`, — **только чтение**: никаких `fetch`, `pull`, `checkout` и иных синхронизирующих/изменяющих команд (mandate 08-04).
2. **Скан входящих — два канала** (набор = объединение источников):
   - локально: файлы в корне `../brain_matrica/mailboxes/vMalmyzhe/from-brain/*.md` (НЕ `DRAFTS/`, НЕ `ARCHIVE/`);
   - на GitHub `main` проекта `Valstan/brain_matrica`: те же пути через API/веб (например, `https://api.github.com/repos/Valstan/brain_matrica/contents/mailboxes/vMalmyzhe/from-brain` → raw-чтение файлов), **без clone/fetch/pull**.
   Свежесть — по каждому письму и пути: незакоммиченная локальная версия — свежее; иначе последний локальный коммит файла vs последний коммит пути на GitHub; порядок не определяется — прочитать обе версии, явно отметить конфликт, **не перезаписывать**.
3. **Доложи** сводку писем ДО чтения handoff:
   ```
   📬 N писем от brain_matrica:
   - [urgency COMPLIANCE] YYYY-MM-DD-slug — тема
   ```
   `urgency: high` выдели отдельно. Письма без `compliance`: `kind: directive`→MUST, `kind: idea`→SHOULD.
4. **Прочитай** `docs/SESSION_HANDOFF.md` — статус, нитка, следующий шаг. Если `Updated:` старше 14 дней — пометь «может быть неактуально».
5. **Сводка main:** `git log --oneline -5` и `git status`.
6. Кратко предложи следующий шаг из handoff.

Не начинай правки кода до завершения шагов 1–4.
