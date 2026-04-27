import React, { useState } from 'react';
import { ResumeCandidate } from '../state/types';

interface ResumeSelectorProps {
  candidates: ResumeCandidate[];
  selectedHash: string | null;
  onSelect: (hash: string | null) => void;
  showAddDemo?: boolean;
  onAddDemo?: () => void;
  showDetectButton?: boolean;
  liveModeActive?: boolean;
  controlledTabBound?: boolean;
}

export const ResumeSelector: React.FC<ResumeSelectorProps> = ({
  candidates,
  selectedHash,
  onSelect,
  showAddDemo,
  onAddDemo,
  showDetectButton = true,
  liveModeActive = false,
  controlledTabBound = false,
}) => {
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  const handleDetectResumes = async () => {
    setDetecting(true);
    setDetectError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'LIVE_MODE_DETECT_RESUMES',
      });

      if (response.error) {
        setDetectError(response.error);
      }
    } catch (error) {
      setDetectError((error as Error).message);
    } finally {
      setDetecting(false);
    }
  };

  const detectButtonDisabled = detecting || !liveModeActive || !controlledTabBound;

  const demoCount = candidates.filter((c) => c.source === 'demo').length;
  const hhCount = candidates.filter((c) => c.source === 'hh_detected').length;

  // Filter: prefer hh_detected in production view
  const productionCandidates = candidates.filter((c) => c.source === 'hh_detected');
  const displayCandidates = productionCandidates.length > 0 ? productionCandidates : candidates;

  if (candidates.length === 0) {
    return (
      <div className="resume-selector empty">
        <p className="empty-message">Резюме не обнаружены</p>
        {!liveModeActive && (
          <p className="info-message">Запустите live mode для обнаружения резюме</p>
        )}
        {liveModeActive && !controlledTabBound && (
          <p className="warning-message">Откройте HH вкладку для обнаружения резюме</p>
        )}
        {showDetectButton && (
          <button
            className="btn btn-primary"
            onClick={handleDetectResumes}
            disabled={detectButtonDisabled}
            title={
              !liveModeActive
                ? 'Запустите live mode'
                : !controlledTabBound
                  ? 'Откройте HH вкладку'
                  : ''
            }
          >
            {detecting ? 'Обнаружение...' : 'Обнаружить резюме из HH'}
          </button>
        )}
        {detectError && <p className="error-message">{detectError}</p>}
        {showAddDemo && onAddDemo && (
          <button className="btn btn-secondary" onClick={onAddDemo}>
            [DEBUG] Добавить демо-резюме
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="resume-selector">
      {(demoCount > 0 || hhCount > 0) && (
        <div className="resume-source-info">
          {hhCount > 0 && <span className="source-badge hh">HH: {hhCount}</span>}
          {demoCount > 0 && <span className="source-badge demo">Demo: {demoCount}</span>}
        </div>
      )}
      <select
        value={selectedHash || ''}
        onChange={(e) => onSelect(e.target.value || null)}
        className="resume-select"
      >
        <option value="">Резюме не выбрано</option>
        {displayCandidates.map((resume) => (
          <option key={resume.hash} value={resume.hash}>
            {resume.title}
            {resume.isActive === false && ' (неактивно)'}
            {resume.source === 'demo' && ' [DEMO]'}
          </option>
        ))}
      </select>

      {showDetectButton && (
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleDetectResumes}
          disabled={detecting}
        >
          {detecting ? 'Обнаружение...' : 'Обновить из HH'}
        </button>
      )}

      {detectError && <p className="error-message">{detectError}</p>}

      {showAddDemo && onAddDemo && (
        <button className="btn btn-secondary btn-sm" onClick={onAddDemo}>
          Добавить демо-резюме
        </button>
      )}
    </div>
  );
};
