import type { AIProviderId } from './types';

const STORAGE_KEY = 'questionnaire_provider_credentials_v1';
type CredentialMap = Partial<Record<AIProviderId, string>>;

export interface ProviderCredentialStatus {
  configured: boolean;
  hint?: string;
}

export class ProviderCredentialStore {
  private writeQueue: Promise<void> = Promise.resolve();

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
    await this.changeCredentials(credentials => ({ ...credentials, [providerId]: value }));
  }

  async remove(providerId: AIProviderId): Promise<void> {
    await this.changeCredentials(credentials => {
      const next = { ...credentials };
      delete next[providerId];
      return next;
    });
  }

  private changeCredentials(transform: (current: CredentialMap) => CredentialMap): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const result = await this.storage.get(STORAGE_KEY);
      const current = { ...(result[STORAGE_KEY] as CredentialMap | undefined) };
      await this.storage.set({ [STORAGE_KEY]: transform(current) });
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
