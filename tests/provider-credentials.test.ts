import { ProviderCredentialStore } from '../src/questionnaires';

describe('ProviderCredentialStore', () => {
  it('stores credentials outside the application state and only exposes a masked hint', async () => {
    vi.mocked(chrome.storage.local.get)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ questionnaire_provider_credentials_v1: { openai: 'sk-secret-1234' } });
    const store = new ProviderCredentialStore();

    await store.set('openai', ' sk-secret-1234 ');
    await expect(store.status('openai')).resolves.toEqual({ configured: true, hint: '••••1234' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      questionnaire_provider_credentials_v1: { openai: 'sk-secret-1234' },
    });
  });

  it('removes only the selected provider credential', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      questionnaire_provider_credentials_v1: { openai: 'one', groq: 'two' },
    });
    const store = new ProviderCredentialStore();

    await store.remove('openai');

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      questionnaire_provider_credentials_v1: { groq: 'two' },
    });
  });

  it('preserves concurrent writes for different providers', async () => {
    let persisted: Record<string, string> = {};
    const storage = {
      get: vi.fn(async () => ({ questionnaire_provider_credentials_v1: { ...persisted } })),
      set: vi.fn(async (value: Record<string, Record<string, string>>) => {
        await Promise.resolve();
        persisted = { ...value.questionnaire_provider_credentials_v1 };
      }),
    };
    const store = new ProviderCredentialStore(storage as any);

    await Promise.all([
      store.set('openai', 'openai-key'),
      store.set('groq', 'groq-key'),
    ]);

    expect(persisted).toEqual({ openai: 'openai-key', groq: 'groq-key' });
  });
});
