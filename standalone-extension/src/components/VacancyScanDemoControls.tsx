import React from 'react';

interface VacancyScanDemoControlsProps {
  onScanEmpty: () => void;
  onScanWithNew: () => void;
  onMarkExhausted: () => void;
}

export const VacancyScanDemoControls: React.FC<VacancyScanDemoControlsProps> = ({
  onScanEmpty,
  onScanWithNew,
  onMarkExhausted,
}) => {
  return (
    <div className="demo-controls">
      <h4>Демо: Сканирование вакансий</h4>
      <div className="demo-controls-buttons">
        <button className="btn btn-sm btn-secondary" onClick={onScanEmpty}>
          Скан без новых
        </button>
        <button className="btn btn-sm btn-secondary" onClick={onScanWithNew}>
          Скан с новыми
        </button>
        <button className="btn btn-sm btn-secondary" onClick={onMarkExhausted}>
          Отметить исчерпано
        </button>
      </div>
    </div>
  );
};
