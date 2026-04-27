// Notification manager

import { Notification, NotificationLevel, NotificationKind } from '../state/types';

const TOAST_DURATION_MS = 5000;

export class NotificationManager {
  private notifications: Notification[] = [];
  private listeners: Array<(notifications: Notification[]) => void> = [];

  addToast(
    level: NotificationLevel,
    message: string,
    sticky?: boolean,
    kind?: NotificationKind
  ): string {
    const id = this.generateId();
    const notification: Notification = {
      id,
      level,
      message,
      sticky: sticky || false,
      createdAt: Date.now(),
      expiresAt: sticky ? undefined : Date.now() + TOAST_DURATION_MS,
      kind,
    };

    this.notifications.push(notification);
    this.notifyListeners();

    return id;
  }

  addSticky(
    level: NotificationLevel,
    message: string,
    kind?: NotificationKind,
    dedupeKey?: string
  ): string {
    // Dedupe: if sticky with same dedupeKey exists, don't add
    if (dedupeKey) {
      const existing = this.notifications.find(
        (n) => n.sticky && n.dedupeKey === dedupeKey
      );
      if (existing) {
        return existing.id;
      }
    }

    const id = this.generateId();
    const notification: Notification = {
      id,
      level,
      message,
      sticky: true,
      createdAt: Date.now(),
      kind,
      dedupeKey,
    };

    this.notifications.push(notification);
    this.notifyListeners();

    return id;
  }

  dismiss(id: string): void {
    this.notifications = this.notifications.filter((n) => n.id !== id);
    this.notifyListeners();
  }

  dismissByDedupeKey(dedupeKey: string): void {
    this.notifications = this.notifications.filter((n) => n.dedupeKey !== dedupeKey);
    this.notifyListeners();
  }

  clearExpired(): void {
    const now = Date.now();
    this.notifications = this.notifications.filter(
      (n) => n.sticky || !n.expiresAt || n.expiresAt > now
    );
    this.notifyListeners();
  }

  getAll(): Notification[] {
    return [...this.notifications];
  }

  getSticky(): Notification[] {
    return this.notifications.filter((n) => n.sticky);
  }

  getToasts(): Notification[] {
    return this.notifications.filter((n) => !n.sticky);
  }

  subscribe(listener: (notifications: Notification[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    const notifications = this.getAll();
    this.listeners.forEach((listener) => listener(notifications));
  }

  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
