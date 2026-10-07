import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionnairePanel } from '../src/components/QuestionnairePanel';
import { INITIAL_QUESTIONNAIRE_STATE } from '../src/questionnaires';

describe('QuestionnairePanel submission', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    root = null;
    container = null;
  });

  it('shows a failed AI generation instead of claiming a draft is ready', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      success: true,
      item: { status: 'failed', error: 'Лимит провайдера исчерпан' },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <QuestionnairePanel
          view="workspace"
          onPatch={vi.fn()}
          selectedResume={null}
          manualQuestionnaireCount={0}
          state={{
            ...INITIAL_QUESTIONNAIRE_STATE,
            queue: [{
              questionnaire: {
                id: 'q-429', vacancyId: '42', source: 'hh_backend', detectedAt: 1,
                questions: [{ id: 'answer', type: 'text', prompt: 'Опыт', required: true }],
              },
              status: 'ready_for_ai', updatedAt: 1,
            }],
          }}
        />
      );
    });
    const generate = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Сгенерировать');
    expect(generate).toBeDefined();
    await act(async () => { generate?.click(); });
    expect(container.textContent).toContain('Лимит провайдера исчерпан');
    expect(container.textContent).not.toContain('Черновик подготовлен');
  });

  it('saves the blurred answer before submitting from the first click', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let finishRevision!: () => void;
    const revision = new Promise<void>(resolve => { finishRevision = resolve; });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async message => {
      if ((message as { type?: string }).type === 'QUESTIONNAIRE_REVISE_ANSWER') {
        await revision;
      }
      return { success: true };
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <QuestionnairePanel
          view="workspace"
          onPatch={vi.fn()}
          selectedResume={null}
          manualQuestionnaireCount={0}
          state={{
            ...INITIAL_QUESTIONNAIRE_STATE,
            queue: [{
              questionnaire: {
                id: 'q-1', vacancyId: '42', source: 'hh_backend', detectedAt: 1,
                questions: [{ id: 'answer', type: 'text', prompt: 'Опыт', required: true }],
              },
              status: 'needs_review',
              sourceUrl: 'https://hh.ru/vacancy/42',
              answerPlan: {
                questionnaireId: 'q-1', providerId: 'openai', modelId: 'test', generatedAt: 1,
                answers: [{ questionId: 'answer', text: 'Старый', confidence: 0.8, evidence: [], requiresReview: true }],
              },
              updatedAt: 1,
            }],
          }}
        />
      );
    });

    const textarea = container.querySelector('textarea')!;
    const submit = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'Одобрить и отправить')!;
    textarea.value = 'Новый';
    await act(async () => {
      textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      submit.click();
      await Promise.resolve();
    });
    expect(vi.mocked(chrome.runtime.sendMessage)).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRevision();
      await revision;
      await Promise.resolve();
    });
    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([message]) =>
      (message as { type?: string }).type
    )).toEqual(['QUESTIONNAIRE_REVISE_ANSWER', 'QUESTIONNAIRE_APPROVE_AND_SUBMIT']);
    expect(container.textContent).not.toContain('Подтвердить отправку');
  });

  it('separates key validation from a real generation check', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async message => {
      const type = (message as { type?: string }).type;
      if (type === 'AI_PROVIDER_CREDENTIAL_STATUS') return { configured: true, hint: '••••test' };
      if (type === 'QUESTIONNAIRE_LIST_MODELS') {
        return {
          success: true,
          modelDetails: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' }],
        };
      }
      if (type === 'QUESTIONNAIRE_TEST_GENERATION') {
        return { available: false, message: 'На счёте API нет доступной квоты' };
      }
      return { success: true };
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <QuestionnairePanel
          view="settings"
          onPatch={vi.fn()}
          selectedResume={null}
          manualQuestionnaireCount={0}
          state={{
            ...INITIAL_QUESTIONNAIRE_STATE,
            settings: {
              ...INITIAL_QUESTIONNAIRE_STATE.settings,
              provider: {
                ...INITIAL_QUESTIONNAIRE_STATE.settings.provider,
                type: 'openai',
                modelId: 'gpt-4.1-mini',
              },
            },
          }}
        />
      );
      await Promise.resolve();
    });

    const button = (label: string) => Array.from(container!.querySelectorAll('button'))
      .find(item => item.textContent?.trim() === label);
    await act(async () => { button('Проверить ключ')?.click(); });
    expect(container.textContent).toContain('Доступно моделей: 1');

    await act(async () => { button('Проверить генерацию')?.click(); });
    expect(container.textContent).toContain('На счёте API нет доступной квоты');
    expect(vi.mocked(chrome.runtime.sendMessage)).toHaveBeenCalledWith({
      type: 'QUESTIONNAIRE_TEST_GENERATION',
      modelId: 'gpt-4.1-mini',
    });
  });
});
