/**
 * File Logger
 *
 * Persistent logging to chrome.storage.local
 * Logs are available across sessions and can be exported
 */

export interface LogEntry {
  timestamp: string; // ISO 8601
  source: 'service_worker' | 'content_script' | 'sidepanel' | 'popup' | 'parser';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
  screenshot?: string; // base64 data URL
}

const STORAGE_KEY = 'extension_logs';
const MAX_LOGS = 10000; // Rotate after 10k entries

export class FileLogger {
  static async log(
    source: LogEntry['source'],
    level: LogEntry['level'],
    message: string,
    context?: Record<string, any>,
    screenshot?: string
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      source,
      level,
      message,
      context,
      screenshot,
    };

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const logs: LogEntry[] = result[STORAGE_KEY] || [];

      logs.push(entry);

      // Rotation: keep only last MAX_LOGS
      if (logs.length > MAX_LOGS) {
        logs.splice(0, logs.length - MAX_LOGS);
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: logs });
    } catch (err) {
      console.error('[FileLogger] Failed to write log:', err);
    }
  }

  /**
   * Capture screenshot of active tab
   * DISABLED: Causes quota errors and slows down processing
   */
  static async captureScreenshot(): Promise<string | undefined> {
    // Скриншоты отключены из-за ошибок квоты Chrome API
    return undefined;
  }
}
