import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationManager } from '../src/notifications/manager';

describe('NotificationManager', () => {
  let manager: NotificationManager;

  beforeEach(() => {
    manager = new NotificationManager();
  });

  it('should add toast notification', () => {
    const id = manager.addToast('info', 'Test message');

    const notifications = manager.getAll();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe(id);
    expect(notifications[0].message).toBe('Test message');
    expect(notifications[0].level).toBe('info');
    expect(notifications[0].sticky).toBe(false);
    expect(notifications[0].expiresAt).toBeDefined();
  });

  it('should add sticky notification', () => {
    const id = manager.addSticky('warn', 'Sticky message');

    const notifications = manager.getAll();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe(id);
    expect(notifications[0].message).toBe('Sticky message');
    expect(notifications[0].sticky).toBe(true);
    expect(notifications[0].expiresAt).toBeUndefined();
  });

  it('should add notification with kind', () => {
    manager.addToast('success', 'Started', false, 'runtime_started');

    const notifications = manager.getAll();
    expect(notifications[0].kind).toBe('runtime_started');
  });

  it('should dedupe sticky notifications by dedupeKey', () => {
    const id1 = manager.addSticky('warn', 'Warning 1', 'session_warning', 'session_warn');
    const id2 = manager.addSticky('warn', 'Warning 2', 'session_warning', 'session_warn');

    const notifications = manager.getAll();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe(id1);
    expect(id1).toBe(id2); // Same ID returned
  });

  it('should not dedupe sticky without dedupeKey', () => {
    manager.addSticky('warn', 'Warning 1');
    manager.addSticky('warn', 'Warning 2');

    const notifications = manager.getAll();
    expect(notifications).toHaveLength(2);
  });

  it('should dismiss notification by id', () => {
    const id = manager.addToast('info', 'Test');
    expect(manager.getAll()).toHaveLength(1);

    manager.dismiss(id);
    expect(manager.getAll()).toHaveLength(0);
  });

  it('should dismiss notification by dedupeKey', () => {
    manager.addSticky('warn', 'Warning', 'session_warning', 'session_warn');
    expect(manager.getAll()).toHaveLength(1);

    manager.dismissByDedupeKey('session_warn');
    expect(manager.getAll()).toHaveLength(0);
  });

  it('should clear expired toast notifications', async () => {
    manager.addToast('info', 'Expires soon');
    expect(manager.getAll()).toHaveLength(1);

    // Wait for expiration (5000ms + buffer)
    await new Promise((resolve) => setTimeout(resolve, 5100));

    manager.clearExpired();
    expect(manager.getAll()).toHaveLength(0);
  }, 6000);

  it('should not clear sticky notifications on clearExpired', () => {
    manager.addSticky('warn', 'Sticky');
    manager.addToast('info', 'Toast');

    // Manually expire toast
    const notifications = manager.getAll();
    const toast = notifications.find((n) => !n.sticky);
    if (toast && toast.expiresAt) {
      toast.expiresAt = Date.now() - 1000;
    }

    manager.clearExpired();

    const remaining = manager.getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sticky).toBe(true);
  });

  it('should separate sticky and toast notifications', () => {
    manager.addSticky('warn', 'Sticky 1');
    manager.addToast('info', 'Toast 1');
    manager.addSticky('error', 'Sticky 2');
    manager.addToast('success', 'Toast 2');

    const sticky = manager.getSticky();
    const toasts = manager.getToasts();

    expect(sticky).toHaveLength(2);
    expect(toasts).toHaveLength(2);
    expect(sticky.every((n) => n.sticky)).toBe(true);
    expect(toasts.every((n) => !n.sticky)).toBe(true);
  });

  it('should notify listeners on add', () => {
    let notified = false;
    manager.subscribe(() => {
      notified = true;
    });

    manager.addToast('info', 'Test');
    expect(notified).toBe(true);
  });

  it('should notify listeners on dismiss', () => {
    let callCount = 0;
    manager.subscribe(() => {
      callCount++;
    });

    const id = manager.addToast('info', 'Test');
    expect(callCount).toBe(1);

    manager.dismiss(id);
    expect(callCount).toBe(2);
  });

  it('should unsubscribe listener', () => {
    let callCount = 0;
    const unsubscribe = manager.subscribe(() => {
      callCount++;
    });

    manager.addToast('info', 'Test 1');
    expect(callCount).toBe(1);

    unsubscribe();

    manager.addToast('info', 'Test 2');
    expect(callCount).toBe(1); // Not incremented
  });

  it('should handle multiple notifications', () => {
    manager.addToast('info', 'Message 1');
    manager.addToast('success', 'Message 2');
    manager.addSticky('warn', 'Message 3');
    manager.addToast('error', 'Message 4');

    const notifications = manager.getAll();
    expect(notifications).toHaveLength(4);
  });

  it('should generate unique IDs', () => {
    const id1 = manager.addToast('info', 'Test 1');
    const id2 = manager.addToast('info', 'Test 2');

    expect(id1).not.toBe(id2);
  });
});
