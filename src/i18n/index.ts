import { useSyncExternalStore } from 'react';
import { english, russian } from './messages';

export type Language = 'ru' | 'en';
export const LANGUAGE_STORAGE_KEY = 'ui_language';
let language: Language = 'ru';
const listeners = new Set<() => void>();

export function setLanguage(next: Language): void {
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}

export function getLanguage(): Language {
  return language;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

export function t(message: string, ...values: unknown[]): string {
  const translated = (language === 'en' ? english : russian)[message] ?? message;
  return values.length ? translated.replace(/\{(\d+)\}/g, (match, index: string) => (
    Number(index) < values.length ? String(values[Number(index)]) : match
  )) : translated;
}
