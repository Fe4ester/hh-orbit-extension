import React, { useEffect, useState } from 'react';
import { FileLogger, LogEntry } from '../src/utils/fileLogger';

export const LogsViewer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const allLogs = await FileLogger.readLogs();
      setLogs(allLogs);
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    // Level filter
    if (levelFilter !== 'all' && log.level !== levelFilter) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesMessage = log.message.toLowerCase().includes(query);
      const matchesSource = log.source.toLowerCase().includes(query);
      const matchesContext = log.context ? JSON.stringify(log.context).toLowerCase().includes(query) : false;
      return matchesMessage || matchesSource || matchesContext;
    }

    return true;
  });

  const formatLogsAsText = (): string => {
    return filteredLogs.map((log) => {
      const timestamp = new Date(log.timestamp).toLocaleString();
      const level = log.level.toUpperCase().padEnd(5);
      const source = log.source.padEnd(16);
      let line = `[${timestamp}] [${level}] [${source}] ${log.message}`;

      if (log.context) {
        line += '\n' + JSON.stringify(log.context, null, 2);
      }

      return line;
    }).join('\n\n');
  };

  const handleCopyAll = async () => {
    const text = formatLogsAsText();
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  return (
    <div className="logs-viewer-overlay">
      <div className="logs-viewer-container">
        <div className="logs-viewer-header">
          <h2>System Logs</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="logs-viewer-controls">
          <input
            type="text"
            className="logs-search-input"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="logs-level-filter"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
          >
            <option value="all">All Levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={loadLogs}>Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={handleCopyAll} disabled={filteredLogs.length === 0}>
            Copy all
          </button>
          <div className="logs-count">{filteredLogs.length} / {logs.length} entries</div>
        </div>

        <div className="logs-viewer-content">
          {loading ? (
            <div className="logs-loading">Loading logs...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="logs-empty">No logs found</div>
          ) : (
            <pre className="logs-stream">{formatLogsAsText()}</pre>
          )}
        </div>
      </div>
    </div>
  );
};
