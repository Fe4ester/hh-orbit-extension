# HH Orbit Standalone Extension

Browser-first архитектура для автоматизации откликов на HH.ru.

## Структура

- `src/state/` - State store, FSM, типы
- `src/runtime/` - Runtime FSM
- `src/notifications/` - Notification manager
- `src/components/` - React компоненты
- `src/background/` - Service worker
- `sidepanel/` - Sidepanel UI
- `tests/` - Unit тесты

## Установка

```bash
cd standalone-extension
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

## Тесты

```bash
npm test
```

## Загрузка в Chrome

1. Собрать проект: `npm run build`
2. Открыть `chrome://extensions/`
3. Включить "Режим разработчика"
4. "Загрузить распакованное расширение"
5. Выбрать папку `dist/`

## Phase 1 Foundation

Текущая реализация включает:

- ✅ Runtime FSM (IDLE/STARTING/RUNNING/PAUSED/STOPPED/ERROR)
- ✅ Local state store с persistence
- ✅ Notification system (toast/sticky)
- ✅ Sidepanel UI shell
- ✅ Start/Stop/Pause/Resume flow
- ✅ Storage abstraction (chrome.storage + in-memory)
- ✅ Unit tests

Не реализовано (следующие фазы):

- ❌ Live mode / HH DOM integration
- ❌ Apply executor
- ❌ Profiles CRUD
- ❌ Resume detection
- ❌ Backend adapter
- ❌ Manual actions workflow
- ❌ Analytics page
