import React from 'react';
import { AppState } from '../state/types';

interface RuntimeSettingsPanelProps {
  settings: AppState['settings'];
  onPatch: (patch: Partial<AppState['settings']>) => void;
}

export const RuntimeSettingsPanel: React.FC<RuntimeSettingsPanelProps> = ({ settings, onPatch }) => {
  return (
    <div className="runtime-settings-grid">
      <label>
        Min delay (sec)
        <input
          type="number"
          min={1}
          value={settings.delayMinSeconds}
          onChange={(e) => onPatch({ delayMinSeconds: Number(e.target.value) })}
        />
      </label>
      <label>
        Max delay (sec)
        <input
          type="number"
          min={1}
          value={settings.delayMaxSeconds}
          onChange={(e) => onPatch({ delayMaxSeconds: Number(e.target.value) })}
        />
      </label>
      <label>
        Limit per run
        <input
          type="number"
          min={1}
          value={settings.maxAutoAppliesPerRun}
          onChange={(e) => onPatch({ maxAutoAppliesPerRun: Number(e.target.value) })}
        />
      </label>
      <label>
        Limit per day
        <input
          type="number"
          min={1}
          value={settings.maxAutoAppliesPerDay}
          onChange={(e) => onPatch({ maxAutoAppliesPerDay: Number(e.target.value) })}
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.autoSendCoverLetterWhenRequired}
          onChange={(e) => onPatch({ autoSendCoverLetterWhenRequired: e.target.checked })}
        />
        Auto cover letter when required
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.stopOnManualAction}
          onChange={(e) => onPatch({ stopOnManualAction: e.target.checked })}
        />
        Stop on manual action
      </label>
    </div>
  );
};
