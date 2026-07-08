import React from 'react';
import { AppState } from '../state/types';

interface RuntimeSettingsPanelProps {
  settings: AppState['settings'];
  onPatch: (patch: Partial<AppState['settings']>) => void;
}

export const RuntimeSettingsPanel: React.FC<RuntimeSettingsPanelProps> = ({ settings, onPatch }) => {
  return (
    <div className="runtime-settings-grid">
      <label htmlFor="runtime-delay-min">
        Мин. задержка (сек)
        <input
          id="runtime-delay-min"
          type="number"
          min={1}
          value={settings.delayMinSeconds}
          onChange={(e) => onPatch({ delayMinSeconds: Number(e.target.value) })}
        />
      </label>
      <label htmlFor="runtime-delay-max">
        Макс. задержка (сек)
        <input
          id="runtime-delay-max"
          type="number"
          min={1}
          value={settings.delayMaxSeconds}
          onChange={(e) => onPatch({ delayMaxSeconds: Number(e.target.value) })}
        />
      </label>
      <label htmlFor="runtime-limit-run">
        Лимит за запуск
        <input
          id="runtime-limit-run"
          type="number"
          min={0}
          value={settings.maxAutoAppliesPerRun}
          onChange={(e) => onPatch({ maxAutoAppliesPerRun: Number(e.target.value) })}
          placeholder="0 = без лимита"
        />
        <small style={{ fontSize: '11px', color: '#666' }}>0 = без лимита</small>
      </label>
      <label htmlFor="runtime-limit-day">
        Лимит за день
        <input
          id="runtime-limit-day"
          type="number"
          min={0}
          value={settings.maxAutoAppliesPerDay}
          onChange={(e) => onPatch({ maxAutoAppliesPerDay: Number(e.target.value) })}
          placeholder="0 = без лимита"
        />
        <small style={{ fontSize: '11px', color: '#666' }}>0 = без лимита</small>
      </label>
      <label htmlFor="runtime-stop-manual" className="checkbox-row">
        <input
          id="runtime-stop-manual"
          type="checkbox"
          checked={settings.stopOnManualAction}
          onChange={(e) => onPatch({ stopOnManualAction: e.target.checked })}
        />
        Остановить при ручном действии
      </label>
    </div>
  );
};
