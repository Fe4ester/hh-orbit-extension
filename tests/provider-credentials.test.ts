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
});
