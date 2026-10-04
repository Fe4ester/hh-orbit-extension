import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchScreen } from '../sidepanel/LaunchScreen';
import type { LaunchScreenProps } from '../sidepanel/LaunchScreen';

const baseProps: LaunchScreenProps = {
  screen: 'start',
  runtime: {
    runtimeState: 'IDLE',
    phaseLabel: 'Ожидание',
    processed: 0,
    success: 0,
    manualActions: 0,
    pausedReason: null,
    canStart: true,
    canStop: false,
  },
  todaySuccess: 0,
  manualActions: [],
  readiness: {
    profileDone: true,
    resumeDone: true,
    profileName: 'Дизайнер продуктов',
    resumeLabel: 'Продуктовый дизайнер',
  },
  limitsLabel: '30 за запуск · пауза 5–10 с · 100 в день',
  mode: 'backend',
  startError: null,
  lastError: null,
  busy: false,
  onStart: vi.fn(),
  onStop: vi.fn(),
  onGoToProfile: vi.fn(),
  onGoToSettings: vi.fn(),
  onOpenLogs: vi.fn(),
  onOpenAction: vi.fn(),
  onDoneAction: vi.fn(),
  onDismissAction: vi.fn(),
};

function renderScreen(props: LaunchScreenProps) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<LaunchScreen {...props} />);
  });
  return { container, root };
}

describe('LaunchScreen', () => {
  let mounted: Array<ReturnType<typeof createRoot>> = [];
  let containers: HTMLDivElement[] = [];

  afterEach(() => {
    mounted.forEach((root) => act(() => root.unmount()));
    containers.forEach((container) => container.remove());
    mounted = [];
    containers = [];
  });

  it('на стартовом экране блокирует запуск без профиля и резюме и объясняет причину', () => {
    const { container } = renderScreen({
      ...baseProps,
      readiness: { ...baseProps.readiness, profileDone: false, resumeDone: false, profileName: null, resumeLabel: null },
    });
    containers.push(container);

    const startButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Начать поиск'));
    expect(startButton?.disabled).toBe(true);
    expect(container.textContent).toContain('Чтобы запустить поиск, выберите профиль и резюме.');
    expect(container.textContent).toContain('Выберите профиль');
  });

  it('при готовности запускает поиск по клику', () => {
    const onStart = vi.fn();
    const { container } = renderScreen({ ...baseProps, onStart });
    containers.push(container);

    const startButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Начать поиск'));
    expect(startButton?.disabled).toBe(false);
    act(() => startButton?.click());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('на рабочем экране показывает фазу, счётчики и останавливает поиск', () => {
    const onStop = vi.fn();
    const { container } = renderScreen({
      ...baseProps,
      screen: 'running',
      runtime: { ...baseProps.runtime, runtimeState: 'RUNNING', phaseLabel: 'Поиск вакансий', processed: 18, success: 7, canStop: true },
      todaySuccess: 4,
      onStop,
    });
    containers.push(container);

    expect(container.querySelector('.status-banner')?.textContent).toContain('Поиск вакансий');
    expect(container.textContent).toContain('обработано');
    const stopButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Остановить поиск'));
    act(() => stopButton?.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('на экране ручных действий выводит причину и карточки вакансий', () => {
    const { container } = renderScreen({
      ...baseProps,
      screen: 'review',
      runtime: { ...baseProps.runtime, runtimeState: 'PAUSED_MANUAL_ACTION' },
      manualActions: [
        { id: 'm1', type: 'questionnaire', title: 'Product designer', company: 'Ozon', vacancyId: '123', url: 'https://hh.ru/vacancy/123', reasonCode: 'questionnaire_required', createdAt: 1 },
        { id: 'm2', type: 'test', title: 'UX/UI дизайнер', company: 'МТС', vacancyId: '234', url: '', reasonCode: 'test_required', createdAt: 2 },
      ],
    });
    containers.push(container);

    expect(container.textContent).toContain('Нужно ваше решение');
    expect(container.textContent).toContain('Нужно заполнить анкету');
    expect(container.textContent).toContain('Нужно выполнить тест');
    const openButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Открыть');
    expect(openButton?.disabled).toBe(false);
  });

  it('при остановке по исчерпанию вакансий объясняет причину и предлагает повтор', () => {
    const onStart = vi.fn();
    const { container } = renderScreen({
      ...baseProps,
      screen: 'stopped',
      runtime: { ...baseProps.runtime, runtimeState: 'PAUSED_NO_VACANCIES', pausedReason: 'no_vacancies', processed: 18, success: 7 },
      onStart,
    });
    containers.push(container);

    expect(container.textContent).toContain('Подходящие вакансии закончились');
    expect(container.textContent).toContain('18 вакансий');
    const retryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Запустить повторно'));
    act(() => retryButton?.click());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('на экране ошибки показывает последнюю ошибку и ссылку на журнал', () => {
    const onOpenLogs = vi.fn();
    const { container } = renderScreen({
      ...baseProps,
      screen: 'error',
      lastError: 'HTML-контракт изменился',
      onOpenLogs,
    });
    containers.push(container);

    expect(container.textContent).toContain('HTML-контракт изменился');
    const logsButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Открыть журнал'));
    act(() => logsButton?.click());
    expect(onOpenLogs).toHaveBeenCalledTimes(1);
  });

  it('при заблокированном перезапуске объясняет, что делать дальше', () => {
    const { container } = renderScreen({
      ...baseProps,
      screen: 'error',
      runtime: { ...baseProps.runtime, canStart: false },
    });
    containers.push(container);

    const retryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Запустить повторно'));
    expect(retryButton?.disabled).toBe(true);
    expect(container.textContent).toContain('перезагрузите расширение');
  });
});
