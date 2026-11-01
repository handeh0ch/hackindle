# Kindle Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать публично распространяемый, самостоятельно разворачиваемый сервис KOReader с полным функционалом четырёх экранов и сохранением контекста заметок.

**Architecture:** Lua-плагин хранит собственную долговечную очередь и историю на устройстве. Один Express API принимает данные и обслуживает статическую панель; постоянное состояние хранится в стандартной PostgreSQL. Vercel + Neon — основной управляемый вариант, обычный Node.js/контейнер + PostgreSQL — обязательный второй способ запуска того же приложения.

**Tech Stack:** Node.js 24.x, Express 5, JavaScript ES modules, `pg`, `ajv`, `ajv-formats`; платформенный SDK Vercel только в адаптере. HTML/CSS/JavaScript/SVG, Lua/LuaJIT KOReader. Проверки: node:test, Playwright как dev dependency, Lua assertion runner, реальная PostgreSQL и Kindle. Совместимые версии библиотек фиксируются lockfile после проверки актуальной документации.

**Spec:** [Продуктовые требования](../../requirements.md), [контракт данных](../../kindle-sync-data-spec.md), [конфигурация и публичность](../../configuration.md), [исследование хостинга](../../kindle-sync-hosting-research.md).

**Статус:** ОБНОВЛЁННЫЙ ПЛАН НА РЕВЬЮ. Ответы интервью включены; прежнее разделение на урезанный первый релиз и будущие сессии/цели отменено. Приложение и развёртывание не реализованы. Исполнителей запускать только после одобрения этого плана пользователем.

## Global Constraints

- В первый релиз входят обзор, календарь, библиотека, книга с историей процентов/сессиями, цели, циклы, Vocabulary Builder, цитаты/контекст/архив, объединение форматов и подключение.
- Форматы: EPUB, MOBI и PDF с текстовым слоем; AZW3 исключён. Сканам требуется предварительный OCR вне сервиса.
- По умолчанию 2000 символов с пробелами = условная страница; сохраняются точные символы. Смена шрифта не пересчитывает историю.
- Повторный фрагмент засчитывается один раз за день внутри файла; другой формат может засчитать его ещё раз. Перечитывание в другой день считается снова.
- Сессии показывают новый объём за день, включая 0 при перечитывании, и всё активное время по штатным правилам KOReader.
- Контекст — страницы выделения и по одной соседней; у PDF исходные страницы. Позднее извлечение — backfill, ошибка не задерживает заметку.
- Удалённые выделения архивируются; основные списки/счётчики — действующие. Сброс KOReader не удаляет серверную историю.
- source_id — SHA-256 файла, book_id — отдельная идентичность объединённой книги. Переводы/редакции раздельны. Сомнительные объединения подтверждает владелец; merge/split обратимы.
- В карточке прогресс последнего открытого формата; истории/позиции и одинаковые цитаты источников сохраняются раздельно.
- Завершение книги и новый цикл — явные действия на Kindle. Годовая цель считает уникальные объединённые книги. Слова — уникальные сохранённые записи Vocabulary Builder.
- Старые native-страницы — отдельный приблизительный архив; их не складывают с новой серией. Тimestamps UTC, дни по настраиваемой IANA-зоне, интервалы разделяются в полночь.
- Настройки конкретного экземпляра и секреты находятся вне Git. В публичном шаблоне timezone=UTC и пустые секреты; личный профиль владельца остаётся в игнорируемом .env.
- Конфигурация загружается/валидируется один раз и передаётся модулям. Frontend использует относительные API URL; плагин — URL/token владельца. Нет встроенных credentials, доменов или обязательных аккаунтов облачного поставщика.
- Один владелец и один KOReader на экземпляр первоначально. Device bearer отделён от owner session; TLS, CSRF/Origin и отсутствие секретов/читаемого содержимого в логах обязательны.
- Прогресс не чаще раза/минуту; пакеты истории каждые пять активных минут и на lifecycle boundaries. Очередь переживает crash; повторы не включают Wi-Fi и не будят устройство.
- Разработка не должна включать платные тарифы автоматически. Публикация/деплой остаются отдельной финальной операцией после проверяемой подготовки.

## Review Focus

1. PDF zoom/reflow, смена шрифта и повторное чтение не должны незаметно завышать новый объём. Прототип P0 и тесты P1.
2. После crash между сохранением заметки, начислением символов и ack не теряются данные и не повторяется начисление. P2/B2/I1.
3. Merge/split, одинаковые цитаты и разные форматы не перепривязывают контекст/позицию к другому источнику. B3/F2/I1.
4. Native reset, поздние пакеты и owner reset не теряют историю и не воскрешают явно удалённое. C0/B2/P2/I1.
5. Другой сервер/домен/PostgreSQL/timezone и публичный репозиторий не требуют правок исходников и не раскрывают private config. B1/I2.

## Команда, владение и Git

Три исполнителя: **model `gpt-6.1-terra`, reasoning_effort `high`, fork_turns `none`**. Не менять модель молча. В каждом задании передать абсолютный workdir, AGENTS.md, этот план, требования, конфигурацию, контракт и базовый commit.

| Исполнитель | Область файлов |
| --- | --- |
| Backend | `server/`, `db/`, `scripts/`, `tests/server/`, после C0 корневые package/lockfile, `index.js`, `dev.js`, `Dockerfile`, `compose.example.yaml` |
| Plugin | `plugin/`, `tests/plugin/` |
| Panel | `public/`, `tests/panel/` |
| Координатор | `contracts/`, `docs/`, `tests/contracts/`, `tests/e2e/`, `.github/`, ревью/интеграция; начальный package/lockfile в C0 |

Координатор подготавливает отдельные worktree/ветки `.worktrees/backend`, `.worktrees/plugin`, `.worktrees/panel`; каждый исполнитель всегда указывает свой workdir. Первый технический прототип выполняет plugin-исполнитель. После P0 координатор фиксирует C0 и обновляет общую базу; затем три направления работают параллельно. Frontend использует контрактные HTTP fixtures и не ждёт готовый API.

Все изменения контрактов/общих зависимостей идут через координатора. После C0 package/lockfile изменяет backend; frontend не создаёт конкурирующий lockfile. Координатор последовательно переносит проверенные коммиты в main. Не выполнять параллельный git add/commit в одном checkout; не переписывать авторство, не создавать remote и не делать push без поручения.

Ключевые файлы и ответственность:

```text
server/config.js                    validated instance settings
server/app.js                       createApp({db,config}), no listener
server/db.js                        standard pg + transaction on one client
server/auth.js                      owner sessions / scoped device credentials
server/sync.js                      packet validation, dedup, section versions
server/uploads.js                   durable chunks + atomic commit
server/queries.js                   reading reports / note search
server/books.js                     group, split, matches, goals
server/content.js                   versioned paged text and private covers
server/start.js                     standalone entry
server/adapters/vercel.js            optional platform lifecycle integration
db/migrations/*.sql                 standard PostgreSQL schema
scripts/{migrate,setup-owner,export,import}.js
plugin/kindle-sync.koplugin/{main,_meta,adapter,state,context,reading,outbox,transport,vocabulary}.lua
public/{index.html,styles.css}
public/js/{api,app,overview,books,book,annotations,connection,charts}.js
```

Не создавать пустые файлы ради списка. Сохранять функции с одной ответственностью рядом; дополнительные модули только при появлении конкретной необходимости.

## P0 — Прототип совместимости и стабильной метрики

**Owner:** plugin. **Files:** `plugin/COMPATIBILITY.md`, `tests/plugin/fixtures/`, `tests/plugin/prototype/`. **Consumes:** фактическая версия KOReader и синтетические EPUB/MOBI/PDF. **Produces:** проверенные hooks/API, форматы locators, native timing provenance и образцы данных для C0.

- [ ] Определить установленную версию; проверить её исходники и доступные библиотеки. Исследовать hook ordering: annotation save/edit, native-stat flush, rerender, close/suspend/resume, фоновые запросы и SHA-256. Не считать master проверкой устройства.
- [ ] Написать сначала падающие проверки: при одинаковом тексте после font change объём неизменен; повтор в день=0 новых символов; прыжок не считает промежуток. Прототип объединяет интервалы просмотренного текста внутри source/day; фиксирует правило пробелов/Unicode и версию измерения.
- [ ] Для PDF сопоставить native text boxes с видимой областью: crop/zoom, поворот, прокрутка, reflow, колонки, частично видимые слова. Отдельно получить текст исходных страниц N−1/N/N+1 для контекста. Не подменять видимую область полной страницей в статистике.
- [ ] Подтвердить native active intervals и способ запоминать уже начисленные slices без независимого таймера. Проверить min/max настройки установленной версии, полночь и несколько flush одной неподвижной страницы.
- [ ] Проверить стабильные UUID/контекст после перезапуска и редактирования, восстановление engine selection, конец книги, pending/backfill, фоновые запросы без длительного блокирования UI.
- [ ] Записать результаты и замеры. Если стабильный объём/тайминг/PDF не подтверждён, представить конкретный блокер и варианты пользователю до основного построения API; не уменьшать согласованные требования молча.
- [ ] Коммит `test(plugin): establish verified reading and context primitives`.

## C0 — Заморозить контракт и инструменты для трёх исполнителей

**Owner:** координатор. **Files:** `contracts/{sync,uploads,events,read-api}.schema.json`, `contracts/examples/`, `tests/contracts/schema.test.js`, `docs/api-v1.md`, исходные package/lockfile. **Consumes:** P0 и data-spec. **Produces:** точные payload/ack/error/read schemas и общий commit.

- [ ] Зафиксировать sync/config, sync, chunk upload, source covers, vocabulary/legacy packets и все owner routes. Точно описать typed locators, sealed reading events, section versions и поля конфигурационного handshake.
- [ ] Описать ключи idempotence packet/event, семантический JSON hash, независимые версии snapshot sections и exact ack keys. Для owner reset задать tombstones/reset barrier и подтверждаемые client statuses: повтор старой очереди не воскрешает данные, новые наблюдения остаются допустимыми.
- [ ] Определить read API: books/source switch, daily/summary statistics, sessions/cycles, goals, vocabulary, active/archive annotations, group/split/match actions, device setup. Списки — cursor + byte budget; preview до 500 символов; full content частями <=256 КиБ с привязкой к версии. Дневной ряд <=366 дней, all-time summary без неограниченного массива days.
- [ ] Манифест/части: direct JSON <=1 МиБ, envelope <=16 МиБ, raw chunks <=1 МиБ, TTL семь дней, максимум две открытые загрузки/device. Повтор части/commit безопасен, UTF-8 декодируется после сборки, 410 возобновляется новым upload_id со старым envelope/seq.
- [ ] Создать только синтетические fixtures: несколько форматов одной книги, другой перевод, неоднозначные metadata, одинаковые quotes, source switch, rereading zero volume, pending/backfill, архив, legacy, vocabulary unavailable, leap day и разные IANA-зоны/DST. Большие данные генерируются из малых шаблонов, настоящие книги не коммитятся.
- [ ] Создать исходный package с runtime dependencies и Playwright dev dependency, lockfile и scripts `test:contracts`, `test:server`, `test:panel`, `test:e2e`. Tests используют node:test и Playwright configs в своих tests-каталогах. Каждый исполнитель делает npm ci в своём worktree.
- [ ] Сначала увидеть падения `npm run test:contracts`, затем PASS на валидных fixtures и ожидаемые отказы invalid dates/seq/locators/kind/timezone. Уникальность IDs и межполевые проверки закрепить также в backend validator tests.
- [ ] Коммит `chore: freeze portable sync contracts and test fixtures`; передать SHA всем трём исполнителям. После этого изменение схем — только общий checkpoint.

## B1 — Переносимая конфигурация, PostgreSQL и авторизация

**Owner:** backend. **Files:** config/app/db/auth/start, Vercel adapter/entry, migrations, setup-owner/migrate, `.env.example`, Docker/compose, `tests/server/{config,auth,portability}.test.js`. **Interfaces:** `loadConfig(env) -> Config`; `createApp({db,config}) -> Express.Application`; `db.withTransaction(callback) -> Promise<result>`.

- [ ] Написать failing tests: отсутствующая DATABASE_URL, неверные origin/timezone/port/proxy; сообщения содержат имя, но не значение секрета. Инициализированная policy отличается от env — явный отказ без перепроекции истории.
- [ ] Написать auth tests: anonymous read=401, device token на owner read=403, чужой device_id=403; одна привязка при гонке двух UUID; rotation отзывает старый токен. Сессия сохраняется после createApp/restart, logout отзывает её, mutation без CSRF/с чужим Origin отвергается.
- [ ] Реализовать стандартную PostgreSQL-схему: instance/device/owner/session, sources/book groups/memberships, annotation versions/archive, immutable events, snapshot versions, vocabulary, upload manifests/chunks, goals и reset barriers. Проверить ключи/транзакции на реальной тестовой PostgreSQL.
- [ ] Конфиг — один модуль и dependency injection; frontend relative URLs; runtime не требует Neon API. Vercel imports только в адаптере, standalone не открывает Vercel SDK. pg transaction использует один client, connections освобождаются.
- [ ] Добавить приватный bootstrap owner: salted scrypt, случайные hashed device/session secrets, session TTL 14 дней, HttpOnly/SameSite cookie/Secure на HTTPS. Login throttle пять неудач за 15 минут username+IP в общей БД; никакого default owner/password.
- [ ] Добавить dev/start/migrate/setup команды и контейнерный пример. Секреты инжектируются извне; explicit COPY и .dockerignore исключают env/данные. Проверить одно приложение с двумя разными DB URLs/origins/timezones без source edits.
- [ ] Проверка `npm run test:server` на обычной PostgreSQL — PASS. Коммит `feat(server): add portable PostgreSQL application and auth`.

## B2 — Приём, история, архив и большие данные

**Owner:** backend. **Files:** sync/uploads/content, `tests/server/{sync,uploads,archive,reset}.test.js`. **Consumes:** C0/B1. **Produces:** атомарный packet/event API, persisted history и versioned content.

- [ ] Написать tests: duplicate packet/event не добавляет объём/секунды; другой JSON под тем же ID=409; порядок ключей не конфликтует; старый snapshot не побеждает новый; старое независимое progress не теряется после нового annotations. Проверить concurrent first insert/update одной source.
- [ ] Проверить full annotations=[] архивирует, omitted section/ошибка источника — нет. Архив содержит текст/note/context; одинаковые quotes другого source не затрагиваются. Native reset не очищает ledger. Owner reset + старая очередь не воскрешают удалённое.
- [ ] Реализовать validation, packet/event dedup и section versions в транзакциях, COMMIT до ack. Не хранить upload progress в памяти/локальных файлах функции.
- [ ] Upload tests: обрыв/перезапуск/повтор commit; неверные hash/размер/identity; отличающаяся часть на тот же index; UTF-8 через границу частей; TTL=410; превышение open-upload/byte limits. Частичный набор не заменяет live annotations.
- [ ] Реализовать private cover JPEG/WebP <=64 КиБ и content cursors: длинный текст целиком восстанавливается из частей, изменение версии даёт 409 content_changed, пользовательский HTML остаётся текстом.
- [ ] Relevant server tests — PASS с реальной PostgreSQL. Коммит `feat(server): persist idempotent reading history and annotation archive`.

## B3 — Все отчёты, группировка и backup/restore

**Owner:** backend. **Files:** queries/books, export/import scripts, `tests/server/{reports,grouping,backup}.test.js`. **Consumes:** B2/C0. **Produces:** owner read/mutation API для всех четырёх экранов.

- [ ] Написать exact fixture assertions: 4000 chars=2 pages; rerender не меняет прошлое; одна source повторно=0 новых, другая source может начислить снова; session reread имеет время и 0 нового объёма; UTC-midnight split по разным reporting zones; leap day и нулевые дни.
- [ ] Проверить daily/month/year/all-time, current streak, average по прошедшим календарным дням, day record, bounded calendar и totals-only query. Legacy не смешивается; vocabulary unavailable не очищает прежний успешный snapshot.
- [ ] Merge/split tests сохраняют source annotations/positions/events и исходные IDs; ambiguous match требует owner action; переводы раздельны. Annual goal считает grouped unique books, повторный cycle не добавляет новую уникальную книгу; карточка использует последнее открытие источника, не последний network arrival.
- [ ] Реализовать параметризованный SQL, индексы, pagination/search и owner mutations. Не соединять процентные ряды разных источников линией и не восстанавливать отсутствующие прошлые проценты.
- [ ] Добавить export/import данных/обложек без credentials. Import допускается только в пустые таблицы данных; восстанавливает IDs/versions/policy и требует нового приватного bootstrap credentials. Round-trip в другой PostgreSQL сохраняет тексты, counts и totals; непустая цель не меняется.
- [ ] Relevant server tests — PASS. Коммит `feat(server): add grouped reading reports goals and restore`.

## P1 — Учёт чтения, аннотации, контекст и словарь

**Owner:** plugin. **Files:** adapter/state/context/reading/vocabulary, `tests/plugin/run.lua`, `tests/plugin/{reading,context,vocabulary}_test.lua`. **Consumes:** P0/C0. **Produces:** source captures, sealed events и successful snapshots.

- [ ] Написать Lua assertions на P0 fixtures: visible-range union, jump/zoom/rerender, same-day/new-day reread, UTF-8 characters, source-specific identity и общее grouping-neutral происхождение данных. Запустить `luajit tests/plugin/run.lua` и увидеть падения до production реализации.
- [ ] Реализовать собственную SQLite: annotation UUID/context, credited ranges, source IDs, sessions/cycles, native credited slices и immutable events. State advance/event/outbox должны иметь одну транзакционную границу; native DB не меняется.
- [ ] Считать active time через проверенный native adapter, не новый таймер. При reset/native DB unavailable ранее накопленное остаётся; нет повторного начисления одного interval после flush/restart. Report timezone/denominator берутся из authenticated sync profile, не хардкодятся.
- [ ] Контекст tests: первая/последняя, multipage, chapter/footnote/blank, PDF original neighbours, edit note/range, одинаковые quotes в двух форматах. Сохранять selection/position и не генерировать перелистывания; late context=backfill, failure не теряет note.
- [ ] Экспортировать saved vocabulary и legacy archive отдельно. Disabled/unavailable источник не выдавать за пустой успешный набор. Миниатюру извлекать/уменьшать локально; файл книги не отправлять.
- [ ] Lua tests — PASS; аппаратные результаты подтверждаются I1. Коммит `feat(plugin): capture stable reading history notes and vocabulary`.

## P2 — Очередь, протокол и настройки устройства

**Owner:** plugin. **Files:** outbox/transport/main/_meta, `tests/plugin/{outbox,transport}_test.lua`, plugin install guide. **Consumes:** P1/C0. **Produces:** plugin distribution без локальных settings/state.

- [ ] Написать crash tests для границ native note/state/queue/ack. После restart недоставленная note обнаруживается; ранее начисленные chars/time не начисляются снова; потерянный ack повторяет прежние bytes/seq. Не удалять запись по malformed 200/чужому instance/source/неполным result keys.
- [ ] Реализовать один запрос за раз, проверяемый TLS, bounded timeout и проверенный P0 background mechanism. Direct/chunk upload работает с сохранёнными UTF-8 bytes, новый upload_id после 410 не меняет envelope/seq. Oversize удерживается с явной ошибкой.
- [ ] Проверить retries 5/15/60/300, Retry-After, pause on401 и actionable errors400/403/409/413. Wi-Fi off/suspend не запускают сеть; queue остаётся на диске.
- [ ] Настройки URL/token — приватные KOReader settings. Fetch profile проверяет instance/policy; смена сервера не должна незаметно отправлять очередь не тому экземпляру. Добавить sync now/status, queue length, last success/error и явные finish/restart cycle actions.
- [ ] Progress sample раз/минуту плюс границы, sealed reading batches каждые пять активных минут плюс lifecycle flush. Сбор нового текста/контекста не пересылается с каждым минутным progress.
- [ ] Lua tests — PASS; собрать архив по allowlist исходников, проверить отсутствие private config/state/books. Коммит `feat(plugin): deliver durable portable sync client`.

## F1 — Обзор, календарь и библиотека

**Owner:** panel. **Files:** public shell/api/app/overview/books/charts, `tests/panel/{playwright.config,mock-server,overview.spec}.js`. **Consumes:** C0 HTTP fixtures. **Produces:** #/overview и #/books без зависимости от готового backend.

- [ ] Написать Playwright failing cases: login/401, loading/empty/error/retry, выбранный период, 7/14/30-дневный график, год/високосный день, объём/время heatmap, streak/goal/vocabulary и отсутствие fake zeros у unavailable данных.
- [ ] Реализовать все agreed cards, year grid и библиотеку grouped books, covers/fallback, last-source progress. Сохранять точные values, округлять только текст интерфейса; conditional pages подписаны явно.
- [ ] Использовать relative API URLs и test-only mock server. Private env не входит в public/**; HTML/JS не содержит owner instance URL/credentials.
- [ ] Проверить keyboard/accessibility, табличную альтернативу графику, 390/1440 px. `npm run test:panel` — PASS. Коммит `feat(panel): add complete reading overview and grouped library`.

## F2 — Книга, сессии, заметки и управление экземпляром

**Owner:** panel. **Files:** book/annotations/connection modules, `tests/panel/{book,annotations,grouping,connection}.spec.js`. **Consumes:** C0/F1. **Produces:** source switch/history, session/cycle views, note/archive/search, grouping/goals/device setup.

- [ ] Написать cases: separate percentage histories/source switch; sessions with0 new volume; explicit cycles and yearly goal; same quote in EPUB/PDF has separate note/context; search/book/note/archive filters и верные active/archive counts.
- [ ] Реализовать full context через detail/content paging с version restart; pending/unavailable/backfill различаются, book boundaries не создают соседние страницы. Long Russian text и HTML-like quote отображаются безопасно.
- [ ] Добавить uncertain-match confirmation и reversible merge/split; не скрывать формат/происхождение данных. Owner goal/device/reset actions используют CSRF и понятное подтверждение последствий. Reset соответствует C0 barrier, а не простому DELETE с последующим resurrection.
- [ ] Connection view: owner-controlled URL/token rotation, однократный показ нового секрета, last sync. Сервер не изображает известной длину локальной очереди Kindle без отдельной телеметрии.
- [ ] Panel tests — PASS на 390/1440 px и keyboard navigation. Коммит `feat(panel): add source history sessions archive and grouping`.

## I1 — Интеграция и аппаратная приёмка

**Owner:** координатор, fixes возвращаются соответствующему исполнителю. **Files:** `tests/e2e/`, `docs/testing.md`, compatibility report.

- [ ] После ревью переносить законченные коммиты последовательно в main; проверить actual diff/ownership. Выполнить contracts/server/Lua/panel tests, затем `npm run test:e2e` против настоящего приложения и отдельной PostgreSQL, без HTTP mocks.
- [ ] Сквозной сценарий: несколько форматов → grouping → reading/session/finish/cycle → daily/annual dashboard → notes/context → archive → retry/restart. Проверить reset barriers, source switch, partial upload >4,5 МБ логического payload и повтор commit без double count.
- [ ] Проверить owner export/import в другой БД; raw native reset не уменьшает сервисную историю. Fixtures и отчёты не содержат настоящих книг/заметок/credentials.
- [ ] На реальном KOReader повторить P0 краевые случаи, offline/crash/sleep/reconnect, font/zoom changes, слова/обложки, неподдерживаемые данные, выключенный Wi-Fi. Записать версию, фактические delays, размеры, responsiveness и сравнительный battery cost.
- [ ] Если доступа к устройству нет, аппаратная приёмка остаётся открытой. Не заявлять полный релиз только по mocks. Коммит `test: verify complete cross-component reading workflow`.

## I2 — Публичный репозиторий и два воспроизводимых deploy

**Owner:** координатор + backend. **Files:** README, deployment/backup guides, Docker/compose, `.github/workflows/`, секретные значения только вне Git.

- [ ] Проверить `git check-ignore` для root/nested env, plugin state, keys/dumps/books/exports и trackability пустого .env.example/migrations. Ввести redacted staged check и full-history secret scanner в CI/release; fetch полной истории, не только последнего commit. Конкретный scanner/version/action фиксируется по официальному источнику.
- [ ] Проверить образ/архив плагина: populated env, local config, DB dumps, notes и device tokens отсутствуют. Логи/config errors содержат имена настроек, но не значения credentials. Scan failures останавливают публикацию.
- [ ] Документировать команды install/migrate/bootstrap/start и backup/restore для обычного Node.js/PostgreSQL и контейнера. Развернуть тестовый экземпляр на другом origin/timezone и обычной PostgreSQL без правки source; проверить owner/device separation и HTTPS через выбранный reverse proxy.
- [ ] Подготовить Vercel/Neon Free guide/env, проверить адаптер, pooling/TLS и миграции. Идентификаторы проектов и credentials принадлежат оператору, не шаблону репозитория.
- [ ] После разрешения владельца и доступа выкатить подготовленный экземпляр, проверить Kindle HTTPS/cold start/retry и квоты. Платные опции не активируются. Remote/push/publication выполняются только по отдельному поручению, с сохранением выбранного авторства.
- [ ] Коммит `docs: verify portable deployment and public release checks` с фактическими результатами, не секретами.

## Условие готовности и ревью

Все задачи входят в один первый релиз; порядок задач — порядок разработки, не перенос agreed features на неопределённый второй этап. Готовность требует P0/C0, трёх поставок, интеграционных/аппаратных проверок и воспроизводимых способов запуска. Облачная публикация отдельно требует доступа и разрешения.

На текущем этапе выполнены только документация и repository hygiene. Этот план передаётся пользователю на ревью; он ещё не является разрешением запускать implementation.
