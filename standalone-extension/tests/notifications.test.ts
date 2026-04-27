// Notification manager tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationManager } from '../src/notifications/manager';

describe('NotificationManager', () => {
  let manager: NotificationManager;

  beforeEach(() => {
    manager = new NotificationManager();
    vi.useFakeTimers();
  });

  describe('addToast', () => {
    it('should add a toast notification', () => {
      const id = manager.addToast('info', 'Test message');
      const notifications = manager.getAll();

      expect(notifications).toHaveLength(1);
      expect(notifications[0].id).toBe(id);
      expect(notifications[0].level).toBe('info');
      expect(notifications[0].message).toBe('Test message');
      expect(notifications[0].sticky).toBe(false);
      expect(notifications[0].expiresAt).toBeDefined();
    });

    it('should notify listeners', () => {
      const listener = vi.fn();
      manager.subscribe(listener);

      manager.addToast('success', 'Test');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ message: 'Test' }),
        ])
      );
    });
  });

  describe('addSticky', () => {
    it('should add a sticky notification', () => {
      const id = manager.addSticky('warn', 'Sticky message');
      const notifications = manager.getAll();

      expect(notifications).toHaveLength(1);
      expect(notifications[0].id).toBe(id);
      expect(notifications[0].sticky).toBe(true);
      expect(notifications[0].expiresAt).toBeUndefined();
    });
  });

  describe('dismiss', () => {
    it('should remove notification by id', () => {
      const id = manager.addToast('info', 'Test');
      expect(manager.getAll()).toHaveLength(1);

      manager.dismiss(id);
      expect(manager.getAll()).toHaveLength(0);
    });

    it('should notify listeners', () => {
      const listener = vi.fn();
      const id = manager.addToast('info', 'Test');
      manager.subscribe(listener);

      manager.dismiss(id);

      expect(listener).toHaveBeenCalledWith([]);
    });
  });

  describe('clearExpired', () => {
    it('should remove expired toasts', () => {
      manager.addToast('info', 'Toast 1');
      manager.addSticky('warn', 'Sticky 1');

      vi.advanceTimersByTime(6000); // 6 seconds

      manager.clearExpired();

      const notifications = manager.getAll();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toBe('Sticky 1');
    });

    it('should not remove non-expired toasts', () => {
      manager.addToast('info', 'Toast 1');

      vi.advanceTimersByTime(3000); // 3 seconds

      manager.clearExpired();

      expect(manager.getAll()).toHaveLength(1);
    });

    it('should not remove sticky notifications', () => {
      manager.addSticky('error', 'Sticky error');

      vi.advanceTimersByTime(10000); // 10 seconds

      manager.clearExpired();

      expect(manager.getAll()).toHaveLength(1);
    });
  });

  describe('subscribe', () => {
    it('should return unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = manager.subscribe(listener);

      manager.addToast('info', 'Test');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      manager.addToast('info', 'Test 2');
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });
  });
});
