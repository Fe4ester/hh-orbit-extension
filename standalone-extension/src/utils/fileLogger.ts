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
}

const STORAGE_KEY = 'extension_logs';
const MAX_LOGS = 10000; // Rotate after 10k entries

export class FileLogger {
  static async log(
    source: LogEntry['source'],
    level: LogEntry['level'],
    message: string,
    context?: Record<string, any>
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      source,
      level,
      message,
      context,
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

  static async readLogs(limit?: number): Promise<LogEntry[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const logs: LogEntry[] = result[STORAGE_KEY] || [];

      if (limit) {
        return logs.slice(-limit);
      }

      return logs;
    } catch (err) {
      console.error('[FileLogger] Failed to read logs:', err);
      return [];
    }
  }

  /**
   * Read logs filtered by runId
   */
  static async readLogsByRunId(runId: string): Promise<LogEntry[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const logs: LogEntry[] = result[STORAGE_KEY] || [];

      return logs.filter(log => log.context?.runId === runId);
    } catch (err) {
      console.error('[FileLogger] Failed to read logs:', err);
      return [];
    }
  }

  /**
   * Get last N logs and print to console
   */
  static async printLastLogs(limit: number = 50): Promise<void> {
    const logs = await this.readLogs(limit);
    console.log(`\n=== Last ${logs.length} logs ===\n`);
    logs.forEach(log => {
      const ctx = log.context ? ` ${JSON.stringify(log.context)}` : '';
      console.log(`[${log.timestamp}] [${log.source}] [${log.level}] ${log.message}${ctx}`);
    });
  }

  /**
   * Get logs for specific runId and print to console
   */
  static async printRunLogs(runId: string): Promise<void> {
    const logs = await this.readLogsByRunId(runId);
    console.log(`\n=== Logs for runId: ${runId} (${logs.length} entries) ===\n`);
    logs.forEach(log => {
      const ctx = log.context ? ` ${JSON.stringify(log.context)}` : '';
      console.log(`[${log.timestamp}] [${log.source}] [${log.level}] ${log.message}${ctx}`);
    });
  }

  static async clearLogs(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
  }
}
