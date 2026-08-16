import type { AIProviderId } from './types';

const STORAGE_KEY = 'questionnaire_provider_credentials_v1';
type CredentialMap = Partial<Record<AIProviderId, string>>;

export interface ProviderCredentialStatus {
  configured: boolean;
  hint?: string;
}

export class ProviderCredentialStore {
  constructor(private readonly storage = chrome.storage.local) {}

  async get(providerId: AIProviderId): Promise<string | null> {
    const result = await this.storage.get(STORAGE_KEY);
    const value = (result[STORAGE_KEY] as CredentialMap | undefined)?.[providerId];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  async status(providerId: AIProviderId): Promise<ProviderCredentialStatus> {
    const value = await this.get(providerId);
    return value ? { configured: true, hint: `••••${value.slice(-4)}` } : { configured: false };
  }

  async set(providerId: AIProviderId, credential: string): Promise<void> {
    const value = credential.trim();
    if (!value) throw new Error('Введите API-ключ');
    const result = await this.storage.get(STORAGE_KEY);
    const credentials = { ...(result[STORAGE_KEY] as CredentialMap | undefined) };
    credentials[providerId] = value;
    await this.storage.set({ [STORAGE_KEY]: credentials });
  }

  async remove(providerId: AIProviderId): Promise<void> {
    const result = await this.storage.get(STORAGE_KEY);
    const credentials = { ...(result[STORAGE_KEY] as CredentialMap | undefined) };
    delete credentials[providerId];
    await this.storage.set({ [STORAGE_KEY]: credentials });
  }
}
