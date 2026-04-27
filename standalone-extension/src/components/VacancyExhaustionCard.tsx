import React from 'react';
import { VacancyScanState } from '../state/types';

interface VacancyExhaustionCardProps {
  vacancyScan: VacancyScanState;
  exhaustionReason: string | null;
  onReset: () => void;
}

export const VacancyExhaustionCard: React.FC<VacancyExhaustionCardProps> = ({
  vacancyScan,
  exhaustionReason,
  onReset,
}) => {
  if (!vacancyScan.exhausted) {
    return null;
  }

  return (
    <div className="exhaustion-card">
      <div className="exhaustion-icon">⚠️</div>
      <div className="exhaustion-content">
        <h3>Вакансии закончились</h3>
        <p>Новые подходящие вакансии не найдены.</p>
        {exhaustionReason && <p className="exhaustion-reason">{exhaustionReason}</p>}
      </div>
      <button className="btn btn-primary" onClick={onReset}>
        Продолжить поиск
      </button>
    </div>
  );
};
