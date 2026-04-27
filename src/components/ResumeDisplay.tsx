import React from 'react';
import { ResumeCandidate } from '../state/types';

interface ResumeDisplayProps {
  resume: ResumeCandidate | null;
  showEmpty?: boolean;
}

export const ResumeDisplay: React.FC<ResumeDisplayProps> = ({ resume, showEmpty = true }) => {
  if (!resume) {
    if (!showEmpty) {
      return null;
    }
    return (
      <div className="resume-display empty">
        <p>Резюме не выбрано</p>
      </div>
    );
  }

  return (
    <div className="resume-display">
      <div className="resume-title">{resume.title}</div>
      {resume.url && (
        <a href={resume.url} target="_blank" rel="noopener noreferrer" className="resume-link">
          Открыть на HH.ru
        </a>
      )}
      {resume.isActive === false && (
        <div className="resume-warning">⚠️ Резюме неактивно на HH.ru</div>
      )}
    </div>
  );
};
