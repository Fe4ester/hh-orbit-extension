import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIProviderWorkspace } from '../src/components/AIProviderWorkspace';
import { DEFAULT_QUESTIONNAIRE_AI_SETTINGS } from '../src/questionnaires';

describe('AIProviderWorkspace', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('keeps credential state and shows an error when deletion returns an error response', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(chrome.runtime.sendMessage)
      .mockResolvedValueOnce({ configured: true, hint: '••••1234' })
      .mockResolvedValueOnce({ error: 'storage unavailable' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AIProviderWorkspace
          provider={DEFAULT_QUESTIONNAIRE_AI_SETTINGS.provider}
          onPatch={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const deleteButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'Удалить');
    expect(deleteButton).toBeDefined();

    await act(async () => {
      deleteButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('storage unavailable');
    expect(container.textContent).toContain('Ключ сохранён');
    expect(container.textContent).toContain('••••1234');
    expect(deleteButton?.disabled).toBe(false);
  });

  it('shows an error when credential status returns an error response', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ error: 'status unavailable' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AIProviderWorkspace
          provider={DEFAULT_QUESTIONNAIRE_AI_SETTINGS.provider}
          onPatch={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('status unavailable');
    expect(container.textContent).toContain('Нужен ключ');
  });

  it('opens the provider menu and persists the selected provider defaults', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ configured: false });
    const onPatch = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AIProviderWorkspace
          provider={DEFAULT_QUESTIONNAIRE_AI_SETTINGS.provider}
          onPatch={onPatch}
        />
      );
      await Promise.resolve();
    });

    const trigger = container.querySelector<HTMLButtonElement>('#ai-provider-select');
    await act(async () => { trigger?.click(); });
    expect(container.textContent).toContain('OpenAI · Качество');

    const openAI = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('OpenAI · Качество'));
    await act(async () => { openAI?.click(); });
    expect(onPatch).toHaveBeenCalledWith({
      provider: { type: 'openai', modelId: 'gpt-4.1-mini', customBaseUrl: undefined },
    });
  });
});
