# Оценка проекта

## Краткий вывод

Проект уже имеет рабочее разделение browser-first/live и backend runtime, хорошее покрытие критичных backend-сценариев и заметную тестовую базу. Главный риск сейчас не в отсутствии архитектуры, а в дрейфе реального HH DOM/маршрутов и в смешении UI-наблюдений с бизнес-результатами apply.

## Факты репозитория

- 60 коммитов, 3 ветки; первый коммит 2026-04-27, последний 2026-07-14.
- 114 файлов в `src`, `sidepanel`, `tests`.
- Основной стек: TypeScript, React 18, Vite, Vitest, Chrome Extension APIs.
- Скрипты: `npm run type-check`, `npm test`, `npm run build`.
- Наиболее изменяемые зоны: `sidepanel/styles.css`, `sidepanel/LogsViewer.tsx`, `sidepanel/App.tsx`, `src/runtime/backendHTTPClient.ts`, `src/runtime/backendAutoApplyEngine.ts`, `src/background/service-worker.ts`.
- Bug/fix-история чаще всего затрагивает `backendHTTPClient.ts`, `backend-engine.test.ts`, `backend-http-client.test.ts`, `LogsViewer.tsx`, `service-worker.ts`.

## Оценка по направлениям

| Область | Оценка | Комментарий |
|---|---:|---|
| Архитектурное разделение | 8/10 | runtime, acquisition, live/backend и sidepanel разделены достаточно ясно |
| Тестируемость | 8/10 | есть целевые тесты backend, логов, readiness и URL detection |
| Надёжность интеграции HH | 6/10 | DOM/маршруты живые и требуют периодической контрактной сверки |
| Наблюдаемость | 8/10 | есть FileLogger и диагностический UI; чувствительные данные требуют постоянного контроля |
| Поддерживаемость UI | 7/10 | UI уже собран как продуктовый sidepanel, но CSS и service-worker остаются hotspot-зонами |

## Приоритеты

1. Завершить живую карту HH-маршрутов и держать её рядом с тестами URL/DOM.
2. Добавить контрактные фикстуры для карточки вакансии, списка резюме, negotiations и cover-letter modal.
3. Отдельно моделировать `apply outcome`, `manual action`, `chat available` и `redirect`, чтобы UI не смешивал их.
4. Не логировать headers, токены, cookie и query-параметры с чувствительными значениями.
5. После каждого изменения runtime прогонять `npm run type-check`, целевые Vitest-тесты и `npm run build`.
