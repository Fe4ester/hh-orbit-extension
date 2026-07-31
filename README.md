# HH Orbit

HH Orbit — Chromium MV3 расширение для автоматизации откликов на HH.ru.

Текущая версия: `1.0.3`.

## Поддержка браузеров

Поддерживается:

- Chrome;
- Chromium-based браузеры с Manifest V3 и Chrome Side Panel API.

Требуют отдельной smoke-проверки перед публикацией:

- Edge;
- Brave;
- Arc;
- Opera.

Не поддерживаются в `1.0.3`:

- Firefox;
- Safari.

Причина: нужны отдельные manifest variants и UI fallback вместо Chrome Side Panel.

## Лицензия

Проект распространяется по лицензии `PolyForm Noncommercial 1.0.0`.

Разрешено:

- публичное использование;
- личное использование;
- учебное использование;
- исследовательское использование.

Запрещено без отдельного письменного разрешения правообладателя:

- коммерческое использование;
- продажа;
- включение в коммерческие продукты/сервисы.

Полный текст: [LICENSE](./LICENSE)

## Что умеет

- хранит профили поиска с include/exclude keywords;
- выбирает и привязывает резюме к профилю;
- запускает автоотклики в двух режимах: `Backend` и `Live`;
- проверяет сессию HH;
- получает вакансии;
- фильтрует вакансии по профилю;
- выполняет preflight перед откликом;
- отправляет отклики, когда flow безопасен;
- создает manual actions для анкет, тестов, cover letter и других блокеров;
- ведет runtime state в `chrome.storage.local`;
- показывает счетчики запуска: обработано, успех, сегодня, вручную;
- показывает диагностические логи в side panel;
- поддерживает dark/light theme.

## Что изменилось в 1.0.3

`1.0.3` — хотфикс устойчивости Live mode и гигиены release-процесса.

Главное:

- Live mode сохраняет обработанную вакансию до паузы на ручном действии и не создаёт дубли manual actions;
- URL с resume hash редактируются из Live, acquisition и content-script логов;
- версия sidepanel автоматически берётся из manifest;
- из репозитория удалены IDE/Codex-артефакты, а `.gitignore` защищает от их повторного добавления.

Подробности релиза: `artifacts/releases/v1.0.3-notes.md`.

## Что изменилось в 1.0.2

`1.0.2` — хотфикс поиска вакансий по выбранному резюме.

Главное:

- выбранное резюме явно передается из runtime state в запрос поиска;
- поиск останавливается безопасно при login/captcha и изменении HTML-контракта;
- backend и live используют общий парсер поисковой выдачи;
- параллельные обновления резюме объединяются, временная вкладка всегда закрывается;
- чувствительные идентификаторы удаляются из диагностических логов;
- обновлены инструменты сборки с устранением известных уязвимостей.

Подробности релиза: `artifacts/releases/v1.0.2-notes.md`.

## Что изменилось в 1.0.1

`1.0.1` — patch-релиз после цикла стабилизации и UI cleanup.

Главное:

- продукт переименован в `HH Orbit`;
- версия обновлена в `manifest.json`, `package.json`, `package-lock.json`, UI и build output;
- переработан side panel control center;
- исправлен счетчик `сегодня`;
- улучшены manual actions;
- улучшены logs diagnostics;
- закрыта утечка xsrf token в диагностике;
- стабилизированы backend/live runtime ветки;
- расширены тесты.

Подробности релиза: `artifacts/releases/v1.0.1-notes.md`.

## Режимы работы

### Backend mode

HTTP-first режим. Основной runtime работает через HH API/HTTP без постоянного управления видимой вкладкой.

Используется для:

- проверки авторизации;
- восстановления/выбора резюме;
- получения страниц вакансий;
- preflight проверки;
- отправки отклика;
- retry по страницам поиска;
- определения exhausted search space.

Поведение:

- не зависит от активной вкладки для основного цикла;
- продолжает поиск, если текущая страница пустая или отфильтрована;
- не тратит apply limit на manual actions;
- останавливается или ставится на паузу при auth/manual blockers;
- создает manual action, если требуется анкета, тест или cover letter intervention.

### Live mode

Browser-owned режим. Действия выполняются в реальной вкладке HH через DOM.

Используется для:

- работы с реальной страницей вакансии;
- DOM inspection;
- browser-owned apply flow;
- обнаружения тестов/анкет/ручных кейсов;
- навигации по страницам поиска.

Ограничение: Live mode чувствителен к изменениям DOM HH и требует ручной smoke-проверки после релиза.

## Side panel

Side panel — основной control center.

Содержит:

- статус runtime;
- текущую phase;
- счетчики `обработано`, `успех`, `сегодня`, `вручную`;
- кнопки `Старт` / `Стоп`;
- выбор профиля;
- выбор резюме;
- переключатель Backend/Live;
- настройки задержек и лимитов;
- manual actions;
- logs viewer;
- переключатель темы.

В `1.0.1`:

- header больше не sticky;
- dark overscroll не должен показывать белый фон;
- версия `v1.0.1` закреплена рядом с названием `HH Orbit`;
- обновлены иконки и orbit visuals;
- добавлен reusable `SelectMenu`.

## Счетчики

### `обработано`

Количество обработанных вакансий в текущем runtime запуске.

### `успех`

Количество успешных откликов в текущем runtime запуске.

### `сегодня`

Количество успешных локальных apply attempts за текущий локальный календарный день.

Источник: `state.applyAttempts`.

Success считается строго по:

```ts
outcome === 'success'
```

Важно: legacy `analytics.attempts` больше не используется для этого UI-счетчика.

### `вручную`

Количество кейсов, где автоматике потребовалось действие пользователя.

## Manual actions

Manual action создается, если отклик нельзя безопасно завершить автоматически.

Типовые причины:

- требуется анкета;
- требуется тест;
- требуется cover letter;
- нужен login;
- нужна captcha;
- нужен ручной review.

Доступные действия:

- открыть вакансию/страницу;
- отметить как готово;
- скрыть.

Если `Остановить при ручном действии` включено, runtime ставится на паузу при manual action.

## Logs viewer

Logs viewer — основной инструмент диагностики.

Возможности:

- поток runtime logs;
- поиск;
- фильтр по уровню;
- разделение execution errors, warnings и manual cases;
- copy/export для разбора проблем.

В `1.0.1`:

- меньше ложных auth warnings;
- xsrf token редактируется из диагностических сообщений;
- compact logs mode удален.

## Runtime settings

Настройки по умолчанию:

- min delay: `5` секунд;
- max delay: `10` секунд;
- limit per run: `30`;
- limit per day: `100`;
- stop on manual action: включено.

`0` для лимитов означает отсутствие лимита.

## Архитектура

Ключевые директории:

- `src/background/` — service worker и extension message handling;
- `src/runtime/` — backend/live engines, FSM, preflight, acquisition;
- `src/live/` — DOM helpers и live execution;
- `src/state/` — state types, store, actions, selectors, storage;
- `src/components/` — reusable UI components;
- `sidepanel/` — side panel app;
- `src/notifications/` — toast/sticky notifications;
- `src/utils/` — shared utilities;
- `tests/` — unit/behavior tests.

Source of truth:

- `manifest.json`;
- `package.json`;
- `package-lock.json`;
- `src/`;
- `sidepanel/`;
- `tests/`.

Build output:

- `dist/`.

Release-only local artifacts:

- `artifacts/releases/`.

`dist/` и `artifacts/` не являются source of truth.

## Установка для разработки

Требования:

- Node.js;
- npm;
- Chrome или Chromium-based browser.

Установка зависимостей:

```bash
npm install
```

## Разработка

```bash
npm run dev
```

## Проверки

Type check:

```bash
npm run type-check
```

Тесты:

```bash
npm test
```

Production build:

```bash
npm run build
```

## Локальная загрузка в Chrome

1. Собрать проект:

```bash
npm run build
```

2. Открыть:

```text
chrome://extensions/
```

3. Включить `Developer mode`.
4. Нажать `Load unpacked`.
5. Выбрать директорию `dist/`.

## Release flow

1. Обновить версии в:

- `manifest.json`;
- `package.json`;
- `package-lock.json`;

Sidepanel reads its version from `chrome.runtime.getManifest()`, so after the manifest bump it is updated automatically; verify the displayed version in the smoke checklist.

2. Запустить проверки:

```bash
git diff --check
npm run type-check
npm test
npm run build
```

3. Собрать zip из `dist/`:

```bash
(cd dist && zip -qr ../artifacts/releases/hh-orbit-v1.0.3-chromium.zip .)
```

4. Проверить zip:

```bash
unzip -l artifacts/releases/hh-orbit-v1.0.3-chromium.zip
shasum -a 256 artifacts/releases/hh-orbit-v1.0.3-chromium.zip
```

5. Загрузить `dist/` unpacked в Chrome и пройти smoke checklist.

6. Создать tag/release на GitHub.

## Smoke checklist перед публикацией

- `dist/` загружается как unpacked extension;
- название расширения: `HH Orbit`;
- версия в UI: `v1.0.3`;
- dark/light theme переключается;
- при overscroll в dark mode не просвечивает белый фон;
- Backend mode стартует и останавливается;
- counters обновляются логично;
- manual actions отображаются;
- Logs viewer открывается, ищет и фильтрует;
- profile/resume selectors работают;
- build zip содержит `manifest.json`, `background.js`, `content-live-mode.js`, `sidepanel/index.html`, assets и icons.

## Troubleshooting

### Backend mode не идет дальше

Смотреть Logs viewer.

Проверить:

- auth/session status;
- выбранное резюме;
- active profile;
- prefilter results;
- acquisition outcome;
- manual actions;
- exhausted state.

### Live mode завис

Проверить:

- controlled tab;
- page type;
- доступность DOM;
- preflight result;
- test/questionnaire detection;
- runtime blocker.

### Счетчик `сегодня` выглядит неверно

Проверить, что попытки пишутся в `state.applyAttempts` и имеют `createdAt` в текущем локальном дне.

Для backend success нужен outcome:

```text
success
```

### Нужно понять причину остановки

Открыть Logs viewer и смотреть последние events/errors/manual cases.
