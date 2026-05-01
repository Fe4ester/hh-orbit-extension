# HH Orbit Standalone

Расширение Chrome для автоматизации откликов на HH.ru.

Поддерживаются два режима работы:

- `Backend mode` — HTTP-first исполнение без управления страницей на каждом шаге.
- `Live mode` — browser-owned исполнение в реальной вкладке HH.

Текущая кодовая база собрана вокруг стабильного runtime, контролируемых retry, manual actions и нормального логирования.

## Версия

`1.0.0`

## Что умеет расширение

- управляет профилями с include/exclude ключевыми словами;
- выбирает резюме для откликов;
- запускает циклы автооткликов;
- работает в backend и live режимах;
- создаёт manual actions, если вакансия требует участия пользователя;
- хранит runtime state в local storage;
- показывает статус runtime и системные логи в side panel.

## Основные возможности

### 1. Профили

Профиль определяет, что система ищет и на что откликается.

Профиль содержит:

- имя профиля;
- include keywords;
- exclude keywords;
- опциональный шаблон cover letter;
- опционально привязанное резюме.

### 2. Управление резюме

Расширение умеет:

- обнаруживать резюме на HH;
- хранить список доступных резюме;
- привязывать резюме к профилю;
- восстанавливать выбранное резюме для runtime.

### 3. Backend mode

Backend mode использует HTTP requests как основной путь исполнения.

Используется для:

- проверки сессии;
- получения вакансий;
- preflight проверок;
- отправки откликов;
- повторного поиска, когда текущий batch не подходит.

Поведение:

- не зависит от видимой активной вкладки для основного response cycle;
- продолжает retry, пока не наступит реальный stop condition;
- останавливается на blockers, например auth issues или manual actions, если это включено;
- умеет помечать search space как exhausted после серии пустых страниц.

### 4. Live mode

Live mode работает через реальную вкладку HH.

Используется для:

- DOM-взаимодействия со страницей;
- preflight inspection страницы вакансии;
- browser-owned response flow;
- навигации по страницам поиска;
- обнаружения manual action в реальном page context.

### 5. Manual actions

Расширение создаёт manual actions, когда вакансию нельзя завершить автоматически.

Примеры:

- требуется анкета;
- требуется тест;
- другие случаи, где нужен пользователь.

Manual actions показываются в side panel.

Доступные действия:

- открыть;
- отметить как done;
- dismiss.

### 6. Просмотр логов

В side panel есть встроенный viewer логов.

Он поддерживает:

- непрерывный поток логов;
- поиск по тексту;
- фильтр по уровню;
- refresh;
- copy all.

Логи читаются из storage расширения и предназначены для разбора runtime поведения.

## Модель исполнения

### Runtime states

Основные runtime states:

- `IDLE`
- `STARTING`
- `RUNNING`
- `PAUSED_BY_USER`
- `PAUSED_MANUAL_ACTION`
- `PAUSED_NO_VACANCIES`
- `STOPPING`
- `STOPPED`
- `ERROR`

### Важные runtime phases

Типовые фазы во время исполнения:

- `session_check`
- `resume_check`
- `search`
- `apply`
- `waiting`
- `exhausted`

### Stop conditions

Система может остановиться или встать на паузу из-за:

- ручной остановки из UI;
- проблем с авторизацией;
- required manual action;
- настроенного run limit;
- подтверждённого exhaustion search space в backend mode.

## Архитектура

### Структура директорий

- `src/background/` — service worker и message handling;
- `src/runtime/` — backend и live engines, acquisition, preflight, FSM;
- `src/live/` — DOM-oriented helpers и live execution logic;
- `src/state/` — app state, storage, actions, selectors;
- `src/notifications/` — toast и sticky notification manager;
- `src/components/` — переиспользуемые UI components;
- `sidepanel/` — основной UI расширения;
- `src/utils/` — общие utilities, включая file logging и timeout helpers;
- `tests/` — unit и behavior tests.

### Service worker

Файл:

- `src/background/service-worker.ts`

Отвечает за:

- orchestration runtime расширения;
- обработку Chrome extension messages;
- broadcast state и notifications;
- координацию backend и live engines;
- связь с content script.

### Backend engine

Файл:

- `src/runtime/backendAutoApplyEngine.ts`

Отвечает за:

- session check;
- validation и recovery резюме;
- acquisition вакансий;
- apply loop;
- retry и exhaustion behavior;
- stop-on-manual-action policy.

### Live engine

Файл:

- `src/runtime/liveAutoApplyEngineV2.ts`

Отвечает за:

- runtime-owned live execution;
- работу с реальной вкладкой;
- DOM-based apply cycle;
- page availability checks;
- search progression.

### State store

Файлы:

- `src/state/store.ts`
- `src/state/types.ts`
- `src/state/actions.ts`
- `src/state/selectors.ts`
- `src/state/storage.ts`

Отвечает за:

- единый local source of truth для runtime state;
- persistence в `chrome.storage.local`;
- state transitions и mutations;
- хранение profiles, resumes, queue, manual actions и settings.

## Source of truth

Текущий source of truth находится в корне проекта.

Ключевые файлы:

- `manifest.json`
- `package.json`
- `src/...`
- `sidepanel/...`
- `tests/...`

Сгенерированный output:

- `dist/`

`dist/` — это build output, не source of truth.

## Настройки

Текущие runtime defaults:

- min delay: `5` секунд;
- max delay: `10` секунд;
- limit per run: `30`;
- limit per day: `100`;
- stop on manual action: включён по умолчанию.

Поведение cover letter:

- отправка cover letter считается всегда включённой, если cover letter доступен и нужен по flow;
- отдельного пользовательского toggle для этого больше нет.

## Установка

### Что нужно

- Node.js
- npm
- Chrome или другой Chromium-based browser с поддержкой Manifest V3

### Установка зависимостей

```bash
npm install
```

## Разработка

```bash
npm run dev
```

## Сборка

```bash
npm run build
```

Build output пишется в `dist/`.

## Тесты

Запуск всех тестов:

```bash
npm test
```

Только type check:

```bash
npm run type-check
```

## Загрузка в Chrome

1. Выполнить `npm run build`
2. Открыть `chrome://extensions/`
3. Включить Developer mode
4. Нажать `Load unpacked`
5. Выбрать директорию `dist/`

## Как использовать

### Базовый flow

1. Установить и загрузить расширение.
2. Открыть side panel.
3. Обновить список резюме из HH.
4. Создать или отредактировать профиль.
5. Выбрать режим:
   - Backend
   - Live
6. Настроить delays и limits.
7. Запустить runtime.

### Практические рекомендации

- держать profile keywords достаточно строгими, чтобы уменьшить поток мусорных вакансий;
- проверять выбранное резюме перед долгими прогонами;
- использовать logs viewer, когда поведение непонятно;
- использовать manual actions panel для анкет и тестов;
- воспринимать backend и live modes как разные operational paths, а не как одинаковые режимы.

## Важные особенности поведения

### Backend mode

- может проходить несколько страниц перед тем, как признать search space exhausted;
- может останавливаться со sticky notification, когда search space исчерпан;
- может вставать на паузу на manual action, если это включено.

### Live mode

- зависит от валидного HH tab context;
- может взаимодействовать с DOM и browser-owned UI flows;
- чувствительнее к page changes и timing.

## Troubleshooting

### Backend mode не продолжает работу

Сначала смотреть logs viewer.

Проверить:

- результат session check;
- результат resume validation;
- acquisition outcome;
- prefilter elimination;
- exhaustion decision.

Типовые причины:

- нет валидной сессии;
- резюме отсутствует или невалидно;
- все fetched вакансии отфильтрованы profile rules;
- search space исчерпан.

### Live mode выглядит зависшим

Проверить:

- состояние controlled tab;
- текущий page type;
- preflight branch;
- repeated skipped outcomes;
- создание manual actions;
- page availability checks.

### Manual actions останавливают run

Если `Stop on manual action` включён, runtime ставится на паузу, когда вакансия требует анкету или тест.

Это ожидаемое поведение.

### Нужны логи

Используй встроенную ссылку `Logs` в side panel.

Logs viewer — основной инструмент для разбора runtime проблем в этом расширении.
